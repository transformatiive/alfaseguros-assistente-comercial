import { conversationAnalysisSchema, type ConversationAnalysis } from "../analysis/schema.js";
import { resolverEquipa, type EquipaColaborador } from "./agregar.js";

/**
 * "Análise de Chamadas · Equipa 360" — what the daily AI analysis says about
 * the 360 team (Sinistros included), joined with the Desk cases.
 * Pure: rows in, numbers out.
 */

export type ResultadoCaso = "won" | "lost" | "open" | "unknown";

export interface ConversaPara360 {
  id: number;
  dia: string;
  agenteId: string | null;
  agenteNome: string | null;
  /** Raw `analysis_json`; validated here, never trusted. */
  analise: unknown;
  /** Outcome of the case the conversation belongs to, or null with no case. */
  resultado: string | null;
  /** True when the case has at least one Desk ticket. */
  temTicket: boolean;
}

interface Analisada {
  c: ConversaPara360;
  a: ConversationAnalysis;
}

export interface PorColaborador360 {
  agenteId: string;
  nome: string;
  conversas: number;
  analisadas: number;
  qualidadeMedia: number | null;
  desviosAltos: number;
  semTicketPct: number | null;
  riscoAlto: number;
}

export interface Equipa360 {
  de: string;
  ate: string;
  kpis: {
    conversas: number;
    analisadas: number;
    /** Average of `qualidadeGlobal` (1–5), one decimal. */
    qualidadeMedia: number | null;
    comDesvioAltoPct: number | null;
    semTicketPct: number | null;
    riscoAltoPct: number | null;
    followUpPct: number | null;
  };
  falhas: { titulo: string; conversas: number; pct: number | null; severidade: "alta" | "media" | "baixa" }[];
  motivos: { nome: string; conversas: number; pct: number | null }[];
  resultados: { id: ResultadoCaso | "sem_ticket"; nome: string; conversas: number; pct: number | null }[];
  porColaborador: PorColaborador360[];
  piores: { id: number; dia: string; agente: string; qualidade: number; categoria: string; resumo: string }[];
}

const NOMES_RESULTADO: Record<ResultadoCaso | "sem_ticket", string> = {
  won: "Negócio ganho",
  lost: "Negócio perdido",
  open: "Ticket em aberto",
  unknown: "Ticket fechado sem resultado",
  sem_ticket: "Sem ticket no Desk",
};

const ORDEM_SEVERIDADE = { alta: 3, media: 2, baixa: 1 } as const;

function pct(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

function mediaQualidade(l: readonly Analisada[]): number | null {
  if (l.length === 0) return null;
  return Math.round((l.reduce((s, x) => s + x.a.qualidadeGlobal, 0) / l.length) * 10) / 10;
}

/** Same deviation written two ways by the AI ("Não confirmou NIF." / "não confirmou o NIF") lands together. */
export function chaveFalha(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(o|a|os|as|do|da|dos|das|de)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultadoDe(c: ConversaPara360): ResultadoCaso | "sem_ticket" {
  if (!c.temTicket) return "sem_ticket";
  const r = c.resultado;
  return r === "won" || r === "lost" || r === "open" ? r : "unknown";
}

const MAX_FALHAS = 8;
const MAX_MOTIVOS = 6;
const MAX_PIORES = 5;

export function agregarEquipa360(
  todas: readonly ConversaPara360[],
  roster: ReadonlyMap<string, EquipaColaborador>,
  de: string,
  ate: string,
): Equipa360 {
  const conversas = todas.filter((c) => resolverEquipa(c.agenteId, c.agenteNome, roster) === "360");
  const analisadas: Analisada[] = [];
  for (const c of conversas) {
    const p = conversationAnalysisSchema.safeParse(c.analise);
    if (p.success) analisadas.push({ c, a: p.data });
  }
  const n = analisadas.length;

  // Falhas mais comuns: % of analysed conversations where the AI found it.
  const falhas = new Map<string, { titulo: string; ids: Set<number>; severidade: "alta" | "media" | "baixa" }>();
  for (const { c, a } of analisadas) {
    for (const d of a.desviosProcedimento) {
      const k = chaveFalha(d.titulo);
      if (!k) continue;
      const f = falhas.get(k) ?? { titulo: d.titulo.trim().replace(/\.$/, ""), ids: new Set<number>(), severidade: d.severidade };
      f.ids.add(c.id);
      if (ORDEM_SEVERIDADE[d.severidade] > ORDEM_SEVERIDADE[f.severidade]) f.severidade = d.severidade;
      falhas.set(k, f);
    }
  }
  const listaFalhas = [...falhas.values()]
    .map((f) => ({ titulo: f.titulo, conversas: f.ids.size, pct: pct(f.ids.size, n), severidade: f.severidade }))
    .sort((a, b) => b.conversas - a.conversas || ORDEM_SEVERIDADE[b.severidade] - ORDEM_SEVERIDADE[a.severidade] || a.titulo.localeCompare(b.titulo, "pt"))
    .slice(0, MAX_FALHAS);

  // Porque ligam (AI category)
  const cat = new Map<string, number>();
  for (const { a } of analisadas) {
    const nome = a.categoria.trim() || "Outro";
    cat.set(nome, (cat.get(nome) ?? 0) + 1);
  }
  const catOrdenadas = [...cat.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt"));
  const motivos = catOrdenadas.slice(0, MAX_MOTIVOS).map(([nome, k]) => ({ nome, conversas: k, pct: pct(k, n) }));
  const resto = catOrdenadas.slice(MAX_MOTIVOS).reduce((s, [, k]) => s + k, 0);
  if (resto > 0) motivos.push({ nome: "Outros motivos", conversas: resto, pct: pct(resto, n) });

  // Como acabaram (every conversation, analysed or not)
  const res = new Map<ResultadoCaso | "sem_ticket", number>();
  for (const c of conversas) res.set(resultadoDe(c), (res.get(resultadoDe(c)) ?? 0) + 1);
  const resultados = (["won", "lost", "open", "unknown", "sem_ticket"] as const).map((id) => ({
    id,
    nome: NOMES_RESULTADO[id],
    conversas: res.get(id) ?? 0,
    pct: pct(res.get(id) ?? 0, conversas.length),
  }));

  // Por colaborador
  const porAgente = new Map<string, ConversaPara360[]>();
  for (const c of conversas) {
    if (!c.agenteId) continue;
    const l = porAgente.get(c.agenteId) ?? [];
    l.push(c);
    porAgente.set(c.agenteId, l);
  }
  const porColaborador = [...porAgente.entries()]
    .map(([agenteId, l]): PorColaborador360 => {
      const an = analisadas.filter((x) => x.c.agenteId === agenteId);
      return {
        agenteId,
        nome: l.find((c) => c.agenteNome)?.agenteNome ?? `Utilizador ${agenteId}`,
        conversas: l.length,
        analisadas: an.length,
        qualidadeMedia: mediaQualidade(an),
        desviosAltos: an.filter((x) => x.a.desviosProcedimento.some((d) => d.severidade === "alta")).length,
        semTicketPct: pct(l.filter((c) => !c.temTicket).length, l.length),
        riscoAlto: an.filter((x) => x.a.riscoPerdaLead === "alto").length,
      };
    })
    .sort((a, b) => b.conversas - a.conversas || a.nome.localeCompare(b.nome, "pt"));

  // Conversas para ouvir: lowest quality first, then most high deviations.
  const piores = [...analisadas]
    .sort(
      (x, y) =>
        x.a.qualidadeGlobal - y.a.qualidadeGlobal ||
        y.a.desviosProcedimento.filter((d) => d.severidade === "alta").length -
          x.a.desviosProcedimento.filter((d) => d.severidade === "alta").length ||
        y.c.dia.localeCompare(x.c.dia),
    )
    .filter((x) => x.a.qualidadeGlobal <= 3)
    .slice(0, MAX_PIORES)
    .map(({ c, a }) => ({
      id: c.id,
      dia: c.dia,
      agente: c.agenteNome ?? "—",
      qualidade: a.qualidadeGlobal,
      categoria: a.categoria,
      resumo: a.feedbackSupervisor || a.narrativaConversa,
    }));

  return {
    de,
    ate,
    kpis: {
      conversas: conversas.length,
      analisadas: n,
      qualidadeMedia: mediaQualidade(analisadas),
      comDesvioAltoPct: pct(analisadas.filter((x) => x.a.desviosProcedimento.some((d) => d.severidade === "alta")).length, n),
      semTicketPct: pct(conversas.filter((c) => !c.temTicket).length, conversas.length),
      riscoAltoPct: pct(analisadas.filter((x) => x.a.riscoPerdaLead === "alto").length, n),
      followUpPct: pct(analisadas.filter((x) => x.a.followUpNecessario).length, n),
    },
    falhas: listaFalhas,
    motivos,
    resultados,
    porColaborador,
    piores,
  };
}
