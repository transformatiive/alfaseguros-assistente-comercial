import { OpenRouterClient } from "@workspace/openrouter";
import { analisarChamada } from "../chamadas-sftp/analisar.js";
import { bucket, lerJson, listar, PREFIXO_AUDIO, PREFIXO_TRANSCRICOES } from "../chamadas-sftp/bucket.js";
import { conversaEmTexto, lerFicheiro, lerTranscricao, nomeBase, palavras } from "../chamadas-sftp/ficheiro.js";
import { diaLisboa } from "../chamadas-sftp/agregar.js";
import { carregarPeriodo, contexto, periodoAnterior } from "../chamadas-sftp/painel.js";
import { gerarDestaques } from "../chamadas-sftp/destaques.js";
import {
  chamadasPorAnalisar,
  ficheirosRegistados,
  guardarAnalise,
  guardarDestaques,
  marcarDescartada,
  marcarErro,
  registarGravacoes,
} from "../storage/chamadas-sftp-repo.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

/**
 * Análise das chamadas da campanha Vida (TRNSF-2205):
 *
 * 1. Regista na base cada mp3 novo em `shared/` (o total "recebidas").
 * 2. Para as que já têm `transcricoes/<nome>.json` (escrito de noite pelo
 *    transcritor), pede ao modelo a avaliação contra o guião.
 * 3. Se analisou alguma, reescreve os "Destaques da IA" dos últimos 7 dias.
 *
 * Idempotente: uma chamada analisada nunca volta a ser enviada ao modelo; as
 * que deram erro são tentadas outra vez na execução seguinte.
 */

/** Igual ao transcritor: abaixo disto a gravação não é transcrita. */
const TAMANHO_MINIMO = 50_000;
/** Menos palavras do que isto (os dois lados somados) não é conversa. */
const MIN_PALAVRAS = 15;
const CONCORRENCIA = 3;

export interface ResumoExecucao {
  novas: number;
  analisadas: number;
  descartadas: number;
  erros: number;
  custoUsd: number;
  destaques: boolean;
}

let aCorrer = false;

export function emExecucao(): boolean {
  return aCorrer;
}

function clienteOpenRouter(): OpenRouterClient | null {
  const cfg = env();
  if (!cfg.OPENROUTER_API_KEY) return null;
  return new OpenRouterClient({
    apiKey: cfg.OPENROUTER_API_KEY,
    appReferer: cfg.PUBLIC_APP_URL,
    appTitle: "Alfaseguros Supervisor Virtual",
  });
}

export async function processarChamadasSftp(opts: { limite?: number } = {}): Promise<ResumoExecucao> {
  const resumo: ResumoExecucao = { novas: 0, analisadas: 0, descartadas: 0, erros: 0, custoUsd: 0, destaques: false };
  const client = clienteOpenRouter();
  if (!bucket() || !client) {
    logger.info("chamadas-sftp: bucket ou OpenRouter por configurar, nada a fazer");
    return resumo;
  }
  if (aCorrer) {
    logger.info("chamadas-sftp: já há uma execução em curso");
    return resumo;
  }
  aCorrer = true;
  try {
    const modelo = env().OPENROUTER_MODEL_SFTP;
    const [audios, transcricoes, registados] = await Promise.all([
      listar(PREFIXO_AUDIO),
      listar(PREFIXO_TRANSCRICOES),
      ficheirosRegistados(),
    ]);

    const novas = audios
      .filter((o) => o.Key && o.Key.toLowerCase().endsWith(".mp3") && !registados.has(o.Key))
      .map((o) => {
        const chave = o.Key as string;
        const dados = lerFicheiro(chave);
        const tamanho = o.Size ?? 0;
        return {
          ficheiro: chave,
          dataHora: dados.dataHora ?? o.LastModified ?? new Date(),
          telefone: dados.telefone,
          tamanhoBytes: tamanho,
          estado: tamanho < TAMANHO_MINIMO ? ("curta" as const) : ("pendente" as const),
        };
      });
    await registarGravacoes(novas);
    resumo.novas = novas.length;

    // Transcrição por nome base: o transcritor grava `transcricoes/<nome>.json`.
    const transcritas = new Map<string, string>();
    for (const o of transcricoes) if (o.Key?.endsWith(".json")) transcritas.set(nomeBase(o.Key), o.Key);

    const ficheirosComTranscricao = audios
      .map((o) => o.Key ?? "")
      .filter((k) => k && transcritas.has(nomeBase(k)));
    let porAnalisar = (await chamadasPorAnalisar(ficheirosComTranscricao)).sort(
      (a, b) => a.dataHora.getTime() - b.dataHora.getTime(),
    );
    if (opts.limite && opts.limite > 0) porAnalisar = porAnalisar.slice(0, opts.limite);

    logger.info(
      { audios: audios.length, transcricoes: transcricoes.length, novas: novas.length, porAnalisar: porAnalisar.length },
      "chamadas-sftp: inventário",
    );

    await mapWithConcurrency(porAnalisar, CONCORRENCIA, async (chamada) => {
      const chave = transcritas.get(nomeBase(chamada.ficheiro)) as string;
      let duracao: number | null = null;
      try {
        const t = lerTranscricao(await lerJson(chave));
        if (!t) throw new Error("Transcrição com formato inesperado");
        duracao = t.duracao_s;
        if (palavras(t) < MIN_PALAVRAS) {
          await marcarDescartada(chamada.id, {
            duracaoS: t.duracao_s,
            motivo: "Quase sem fala (caixa de correio ou chamada sem resposta)",
            resumo: "",
            modelo: null,
            custoUsd: 0,
          });
          resumo.descartadas += 1;
          return;
        }
        const r = await analisarChamada(conversaEmTexto(t), { client, modelo });
        const custo = r.custo?.costUsd ?? 0;
        resumo.custoUsd += custo;
        if (!r.ok) {
          await marcarErro(chamada.id, r.erro, duracao);
          resumo.erros += 1;
          logger.warn({ ficheiro: chamada.ficheiro, erro: r.erro }, "chamadas-sftp: análise falhou");
          return;
        }
        if (!r.analise.util) {
          await marcarDescartada(chamada.id, {
            duracaoS: t.duracao_s,
            motivo: r.analise.motivo,
            resumo: r.analise.resumo,
            modelo,
            custoUsd: custo,
          });
          resumo.descartadas += 1;
          return;
        }
        await guardarAnalise(chamada.id, {
          duracaoS: t.duracao_s,
          tipo: r.analise.tipo,
          resumo: r.analise.resumo,
          desfecho: r.analise.desfecho,
          objecoes: r.analise.objecoes,
          resultados: r.analise.resultados,
          modelo,
          custoUsd: custo,
        });
        resumo.analisadas += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await marcarErro(chamada.id, msg.slice(0, 500), duracao);
        resumo.erros += 1;
        logger.warn({ ficheiro: chamada.ficheiro, err: msg }, "chamadas-sftp: erro a processar");
      }
    });

    if (resumo.analisadas > 0) {
      resumo.destaques = await atualizarDestaques(client, modelo);
    }

    logger.info(resumo, "chamadas-sftp: execução concluída");
    return resumo;
  } finally {
    aCorrer = false;
  }
}

/** Reescreve os destaques dos últimos 7 dias (até hoje, em Lisboa). */
export async function atualizarDestaques(client: OpenRouterClient, modelo: string): Promise<boolean> {
  const ate = diaLisboa(new Date());
  const de = new Date(Date.parse(`${ate}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const atual = await carregarPeriodo(de, ate);
  if (atual.agregado.kpis.analisadas === 0) return false;
  const ant = periodoAnterior(de, ate);
  const anterior = await carregarPeriodo(ant.de, ant.ate);
  const r = await gerarDestaques(
    { de, ate, atual: atual.agregado, anterior: anterior.agregado, ...contexto(atual) },
    { client, modelo },
  );
  if (!r.ok) {
    logger.warn({ erro: r.erro }, "chamadas-sftp: destaques falharam");
    return false;
  }
  await guardarDestaques({ periodoDe: de, periodoAte: ate, conteudo: r.destaques, modelo });
  return true;
}

/**
 * Corre de hora a hora (e 2 minutos depois do arranque). Barato quando não há
 * nada de novo: só lista o bucket. O transcritor corre às 02:00, por isso as
 * chamadas do dia anterior estão analisadas antes das 07:00.
 */
export function iniciarAgendadorChamadasSftp(): void {
  if (env().SFTP_ANALISE_AUTOMATICA === "0") return;
  if (!bucket()) {
    logger.info("chamadas-sftp: SFTP_S3_* por configurar, agendador desligado");
    return;
  }
  const correr = () => {
    processarChamadasSftp().catch((err) => logger.error({ err }, "chamadas-sftp: execução falhou"));
  };
  setTimeout(correr, 2 * 60_000).unref();
  setInterval(correr, 60 * 60_000).unref();
}
