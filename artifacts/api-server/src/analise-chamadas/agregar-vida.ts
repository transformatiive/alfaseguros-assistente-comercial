import { percentagem } from "../chamadas-sftp/agregar.js";
import { PONTOS, tipoGuiao } from "../chamadas-sftp/catalogo.js";
import { CONVERSA_REAL_MIN_S, type ChamadaParaAgregar } from "./agregar.js";

/**
 * Análise de Chamadas · Equipa Vida (fase 5). Junta, por pessoa da equipa Vida:
 * - o que o Ringover diz (chamadas feitas, conversas reais, minutos ao telefone);
 * - a nota do guião das chamadas avaliadas (mesmo guião da SolidNetworks);
 * - as chamadas que não aparecem em nenhuma lead do noCRM.
 *
 * Pura: recebe linhas já lidas da base, para se testar sem base.
 */

export interface ChamadaGuiao {
  id: number;
  agenteId: string | null;
  colaborador: string;
  estado: string;
  tipo: string | null;
  gravacaoUrl: string | null;
}

export interface ResultadoGuiao {
  chamadaId: number;
  item: string;
  estado: string;
  rever: boolean;
}

export interface PessoaVida {
  agenteId: string;
  nome: string;
  feitas: number;
  recebidas: number;
  conversasReais: number;
  conversasReaisPct: number | null;
  minutos: number;
  avaliadas: number;
  guiaoPct: number | null;
  /** Ponto do guião com a % mais baixa (mínimo 3 avaliações), ou null. */
  pontoMaisFraco: { item: string; validacao: string; tipo: string; pct: number } | null;
  semLead: number | null;
}

export interface EquipaVida {
  de: string;
  ate: string;
  kpis: {
    feitas: number;
    recebidas: number;
    conversasReais: number;
    conversasReaisPct: number | null;
    minutos: number;
    avaliadas: number;
    guiaoPct: number | null;
    /** null quando o noCRM ainda não tem chamadas neste período (por ligar). */
    semLead: number | null;
    semLeadPct: number | null;
  };
  porColaborador: PessoaVida[];
}

/** O nome do ficheiro mp3 de uma gravação do Ringover: liga a chamada à nota no noCRM. */
export function chaveGravacao(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /([^/?#]+\.mp3)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function pct(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

export function agregarEquipaVida(input: {
  de: string;
  ate: string;
  /** Chamadas Ringover do período, já só da equipa Vida. */
  chamadas: readonly ChamadaParaAgregar[];
  /** Nomes por agente (roster), para quem não aparece nas avaliações. */
  nomes: ReadonlyMap<string, string>;
  avaliacoes: readonly ChamadaGuiao[];
  resultados: readonly ResultadoGuiao[];
  /** Gravações que aparecem em notas do noCRM; null = noCRM sem dados no período. */
  gravacoesNoCrm: ReadonlySet<string> | null;
}): EquipaVida {
  type Acum = {
    feitas: number;
    recebidas: number;
    reais: number;
    segundos: number;
    avaliadas: number;
    cumpriu: number;
    nao: number;
    porItem: Map<string, { cumpriu: number; nao: number }>;
    comGravacao: number;
    semLead: number;
  };
  const novo = (): Acum => ({
    feitas: 0,
    recebidas: 0,
    reais: 0,
    segundos: 0,
    avaliadas: 0,
    cumpriu: 0,
    nao: 0,
    porItem: new Map(),
    comGravacao: 0,
    semLead: 0,
  });
  const porAgente = new Map<string, Acum>();
  const nomeDe = new Map<string, string>(input.nomes);
  const acum = (id: string) => {
    let a = porAgente.get(id);
    if (!a) porAgente.set(id, (a = novo()));
    return a;
  };

  for (const c of input.chamadas) {
    if (!c.agenteId) continue;
    const a = acum(c.agenteId);
    if (!nomeDe.has(c.agenteId) && c.agenteNome) nomeDe.set(c.agenteId, c.agenteNome);
    if (c.direcao === "out") a.feitas++;
    else a.recebidas++;
    if (c.atendida && (c.duracaoS ?? 0) >= CONVERSA_REAL_MIN_S) a.reais++;
    if (c.atendida && c.duracaoS) a.segundos += c.duracaoS;
  }

  const agenteDaChamada = new Map<number, string>();
  for (const c of input.avaliacoes) {
    if (!c.agenteId) continue;
    agenteDaChamada.set(c.id, c.agenteId);
    if (!nomeDe.has(c.agenteId)) nomeDe.set(c.agenteId, c.colaborador);
    const a = acum(c.agenteId);
    if (c.estado === "analisada") a.avaliadas++;
    const chave = chaveGravacao(c.gravacaoUrl);
    if (input.gravacoesNoCrm && chave && c.estado !== "curta") {
      a.comGravacao++;
      if (!input.gravacoesNoCrm.has(chave)) a.semLead++;
    }
  }

  for (const r of input.resultados) {
    const id = agenteDaChamada.get(r.chamadaId);
    if (!id || r.rever || r.estado === "nao_aplicavel") continue;
    const a = acum(id);
    const it = a.porItem.get(r.item) ?? { cumpriu: 0, nao: 0 };
    if (r.estado === "cumprido") {
      a.cumpriu++;
      it.cumpriu++;
    } else {
      a.nao++;
      it.nao++;
    }
    a.porItem.set(r.item, it);
  }

  const porColaborador: PessoaVida[] = [...porAgente.entries()]
    .map(([agenteId, a]) => {
      const fracos = [...a.porItem.entries()]
        .filter(([, c]) => c.cumpriu + c.nao >= 3)
        .map(([item, c]) => ({ item, pct: percentagem(c) ?? 0 }))
        .sort((x, y) => x.pct - y.pct);
      const f = fracos[0];
      const pt = f ? PONTOS.get(f.item) : undefined;
      return {
        agenteId,
        nome: nomeDe.get(agenteId) ?? agenteId,
        feitas: a.feitas,
        recebidas: a.recebidas,
        conversasReais: a.reais,
        conversasReaisPct: pct(a.reais, a.feitas + a.recebidas),
        minutos: Math.round(a.segundos / 60),
        avaliadas: a.avaliadas,
        guiaoPct: percentagem(a),
        pontoMaisFraco:
          f && pt ? { item: f.item, validacao: pt.validacao, tipo: tipoGuiao(pt.tipo).nome, pct: f.pct } : null,
        semLead: input.gravacoesNoCrm ? a.semLead : null,
      };
    })
    .sort((x, y) => y.feitas + y.recebidas - (x.feitas + x.recebidas) || x.nome.localeCompare(y.nome, "pt"));

  const soma = (k: keyof Acum) =>
    [...porAgente.values()].reduce((s, a) => s + (typeof a[k] === "number" ? (a[k] as number) : 0), 0);
  const feitas = soma("feitas");
  const recebidas = soma("recebidas");
  const reais = soma("reais");
  const comGravacao = soma("comGravacao");
  const semLead = soma("semLead");
  return {
    de: input.de,
    ate: input.ate,
    kpis: {
      feitas,
      recebidas,
      conversasReais: reais,
      conversasReaisPct: pct(reais, feitas + recebidas),
      minutos: Math.round(soma("segundos") / 60),
      avaliadas: soma("avaliadas"),
      guiaoPct: percentagem({ cumpriu: soma("cumpriu"), nao: soma("nao") }),
      semLead: input.gravacoesNoCrm ? semLead : null,
      semLeadPct: input.gravacoesNoCrm ? pct(semLead, comGravacao) : null,
    },
    porColaborador,
  };
}
