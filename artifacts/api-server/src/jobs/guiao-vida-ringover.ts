import { concatenateTranscript, getAgentUserId, pickCustomerNumber, RingoverClient, type RingoverCall } from "@workspace/ringover";
import { analisarChamada } from "../chamadas-sftp/analisar.js";
import { diaLisboa } from "../chamadas-sftp/agregar.js";
import { CONVERSA_REAL_MIN_S, resolverEquipa, type EquipaColaborador } from "../analise-chamadas/agregar.js";
import { normalizarChamada } from "../analise-chamadas/normalizar.js";
import {
  chamadasVidaPorAnalisar,
  guardarAnalise,
  marcarDescartada,
  marcarErro,
  registarChamadasVida,
  type ChamadaVidaNova,
} from "../storage/chamadas-sftp-repo.js";
import { carregarNomesColaboradores, carregarRosterEquipas } from "../storage/chamadas-ringover-repo.js";
import { atualizarDestaques, clienteOpenRouter } from "./chamadas-sftp.js";
import { lisbonDayBoundsISO } from "../lib/dates.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

/**
 * Análise de Chamadas · Equipa Vida (fase 5): as chamadas da equipa Vida no
 * Ringover avaliadas com o mesmo guião da campanha SolidNetworks (decisão de
 * 30/10/2026). Ficam nas tabelas `chamadas_sftp` com fonte "ringover", para os
 * mesmos ecrãs e a lista única de chamadas servirem as duas fontes.
 *
 * 1. Lê no Ringover as chamadas dos últimos dias e regista as atendidas da
 *    equipa Vida (abaixo de 30 s ficam como "curta" e não vão ao modelo).
 * 2. Para cada pendente, pede a transcrição ao Ringover e avalia-a.
 * 3. Se avaliou alguma, reescreve os destaques da IA da equipa Vida.
 *
 * Idempotente: uma chamada avaliada nunca volta ao modelo. Uma sem transcrição
 * fica pendente; passados 3 dias passa a "descartada".
 */

/** Menos palavras do que isto não é conversa. Igual às gravações SFTP. */
const MIN_PALAVRAS = 15;
const CONCORRENCIA = 3;
const DIAS_ESPERA_TRANSCRICAO = 3;

export const PREFIXO = "ringover:";

/** As chamadas atendidas da equipa Vida num dia, prontas a registar. Pura, para testes. */
export function chamadasVidaParaRegistar(
  calls: readonly RingoverCall[],
  roster: ReadonlyMap<string, EquipaColaborador>,
  nomes: ReadonlyMap<string, string>,
): ChamadaVidaNova[] {
  const vistas = new Set<string>();
  const out: ChamadaVidaNova[] = [];
  for (const call of calls) {
    const n = normalizarChamada(call);
    if (!n || !n.atendida || !n.agenteId) continue;
    if (resolverEquipa(n.agenteId, n.agenteNome ?? null, roster) !== "vida") continue;
    // Uma conversa transferida tem várias pernas com o mesmo call_id: fica a primeira.
    const id = String(call.call_id ?? call.cdr_id);
    if (vistas.has(id)) continue;
    vistas.add(id);
    const agente = getAgentUserId(call);
    out.push({
      ficheiro: `${PREFIXO}${id}`,
      dataHora: n.inicio,
      telefone: pickCustomerNumber(call),
      duracaoS: n.duracaoS ?? null,
      colaborador: nomes.get(n.agenteId) ?? n.agenteNome ?? `Ringover ${agente ?? ""}`.trim(),
      agenteId: n.agenteId,
      gravacaoUrl: call.recording_url ?? call.record ?? null,
      estado: (n.duracaoS ?? 0) < CONVERSA_REAL_MIN_S ? "curta" : "pendente",
    });
  }
  return out;
}

/** O id que o Ringover usa em /transcriptions, a partir da chave guardada. */
export function idChamadaRingover(ficheiro: string): string | null {
  return ficheiro.startsWith(PREFIXO) ? ficheiro.slice(PREFIXO.length) : null;
}

export function contarPalavras(texto: string): number {
  return texto
    .split("\n")
    .map((l) => l.replace(/^Locutor [AB?]:\s*/, ""))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export interface ResumoVida {
  registadas: number;
  analisadas: number;
  descartadas: number;
  semTranscricao: number;
  erros: number;
  custoUsd: number;
  destaques: boolean;
}

let aCorrer = false;

export function vidaEmExecucao(): boolean {
  return aCorrer;
}

function ringover(): RingoverClient | null {
  const key = env().RINGOVER_API_KEY;
  return key ? new RingoverClient({ apiKey: key }) : null;
}

/** A transcrição de uma chamada Vida, como texto com os dois locutores. "" quando não há. */
export async function transcricaoVida(ficheiro: string, maxChars = 40_000): Promise<string> {
  const id = idChamadaRingover(ficheiro);
  const r = ringover();
  if (!id || !r) return "";
  return concatenateTranscript(await r.getTranscription(id), { maxChars });
}

/**
 * `dias`: a janela de chamadas a avaliar. `diasRegisto`: quantos dias se voltam
 * a ler no Ringover (por defeito, a janela toda; o agendador só relê 2).
 */
export async function processarGuiaoVida(
  opts: { dias?: number; diasRegisto?: number; limite?: number } = {},
): Promise<ResumoVida> {
  const resumo: ResumoVida = {
    registadas: 0,
    analisadas: 0,
    descartadas: 0,
    semTranscricao: 0,
    erros: 0,
    custoUsd: 0,
    destaques: false,
  };
  const cfg = env();
  const cliente = ringover();
  const client = clienteOpenRouter();
  if (!cliente || !client) {
    logger.info("guião Vida: Ringover ou OpenRouter por configurar, nada a fazer");
    return resumo;
  }
  if (aCorrer) return resumo;
  aCorrer = true;
  try {
    const dias = opts.dias ?? cfg.VIDA_GUIAO_DIAS;
    const limite = opts.limite ?? cfg.VIDA_GUIAO_MAX_POR_EXECUCAO;
    const modelo = cfg.OPENROUTER_MODEL_SFTP;
    const [roster, nomes] = await Promise.all([carregarRosterEquipas(), carregarNomesColaboradores()]);

    // 1. Registar: um pedido de lista por dia, do mais antigo para hoje.
    const hoje = diaLisboa(new Date());
    const diasRegisto = Math.min(opts.diasRegisto ?? dias, dias);
    for (let i = diasRegisto - 1; i >= 0; i--) {
      const dia = new Date(Date.parse(`${hoje}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      try {
        const [inicio, fim] = lisbonDayBoundsISO(dia);
        const calls = await cliente.listCallsBetween(inicio, fim);
        resumo.registadas += await registarChamadasVida(chamadasVidaParaRegistar(calls, roster, nomes));
      } catch (err) {
        logger.warn({ dia, err }, "guião Vida: não foi possível ler as chamadas do dia");
      }
    }

    // 2. Avaliar as pendentes.
    const desde = new Date(Date.parse(`${hoje}T00:00:00Z`) - dias * 86_400_000);
    const porAnalisar = await chamadasVidaPorAnalisar(desde, limite);
    const limiteEspera = Date.now() - DIAS_ESPERA_TRANSCRICAO * 86_400_000;

    await mapWithConcurrency(porAnalisar, CONCORRENCIA, async (chamada) => {
      const duracao = chamada.duracaoS ?? null;
      try {
        const texto = await transcricaoVida(chamada.ficheiro);
        if (!texto) {
          resumo.semTranscricao += 1;
          if (chamada.dataHora.getTime() < limiteEspera) {
            await marcarDescartada(chamada.id, {
              duracaoS: duracao ?? 0,
              motivo: "O Ringover não tem transcrição desta chamada",
              resumo: "",
              modelo: null,
              custoUsd: 0,
            });
            resumo.descartadas += 1;
          }
          return;
        }
        if (contarPalavras(texto) < MIN_PALAVRAS) {
          await marcarDescartada(chamada.id, {
            duracaoS: duracao ?? 0,
            motivo: "Quase sem fala (caixa de correio ou chamada sem resposta)",
            resumo: "",
            modelo: null,
            custoUsd: 0,
          });
          resumo.descartadas += 1;
          return;
        }
        const r = await analisarChamada(texto, { client, modelo });
        const custo = r.custo?.costUsd ?? 0;
        resumo.custoUsd += custo;
        if (!r.ok) {
          await marcarErro(chamada.id, r.erro, duracao);
          resumo.erros += 1;
          return;
        }
        if (!r.analise.util) {
          await marcarDescartada(chamada.id, {
            duracaoS: duracao ?? 0,
            motivo: r.analise.motivo,
            resumo: r.analise.resumo,
            modelo,
            custoUsd: custo,
          });
          resumo.descartadas += 1;
          return;
        }
        await guardarAnalise(chamada.id, {
          duracaoS: duracao ?? 0,
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
        logger.warn({ ficheiro: chamada.ficheiro, err: msg }, "guião Vida: erro a processar");
      }
    });

    if (resumo.analisadas > 0) resumo.destaques = await atualizarDestaques(client, modelo, "ringover");
    logger.info(resumo, "guião Vida: execução concluída");
    return resumo;
  } finally {
    aCorrer = false;
  }
}

/**
 * 3 minutos depois do arranque lê a janela toda (apanha o que faltar); depois,
 * de 3 em 3 horas, só relê ontem e hoje no Ringover.
 */
export function iniciarAgendadorGuiaoVida(): void {
  if (env().VIDA_GUIAO_AUTOMATICO === "0") return;
  const correr = (diasRegisto?: number) => () => {
    processarGuiaoVida({ diasRegisto }).catch((err) => logger.error({ err }, "guião Vida: execução falhou"));
  };
  setTimeout(correr(), 3 * 60_000).unref();
  setInterval(correr(2), 3 * 60 * 60_000).unref();
}
