import { isTeam360Name } from "../lib/teams.js";
import { diaDaSemana, somarDias } from "../lib/dates.js";

/**
 * Macro view of the Ringover calls ("Análise de Chamadas · Visão geral").
 * Pure: takes rows already read from `chamadas_ringover`, returns the numbers
 * the page draws. No database, no clock.
 */

export type EquipaAnalise = "360" | "vida" | "corporate" | "sem_agente";
export type FiltroEquipa = "todas" | "360" | "vida" | "corporate";

export const FILTROS_EQUIPA: readonly FiltroEquipa[] = ["todas", "360", "vida", "corporate"];

/** Equipa as stored in `colaboradores.equipa`. */
export type EquipaColaborador = "360" | "vida" | "admin" | "mkt" | "sinistros";

/**
 * Which team a call belongs to (decided by Nuno, 30/10/2026):
 *   - Sinistros is part of Equipa 360.
 *   - Vida is the roster in `colaboradores` with equipa = vida.
 *   - Everyone else who has a Ringover user counts as Corporate, for now.
 *   - A call with no user at all (missed on a shared line) has no team.
 *
 * The roster wins over the name list; the name list only covers 360 people
 * who are not yet in `colaboradores`.
 */
export function resolverEquipa(
  agenteId: string | null,
  agenteNome: string | null,
  roster: ReadonlyMap<string, EquipaColaborador>,
): EquipaAnalise {
  if (!agenteId) return "sem_agente";
  const equipa = roster.get(agenteId);
  if (equipa === "360" || equipa === "sinistros") return "360";
  if (equipa === "vida") return "vida";
  if (equipa) return "corporate";
  if (isTeam360Name(agenteNome)) return "360";
  return "corporate";
}

export interface ChamadaParaAgregar {
  dia: string;
  hora: number;
  direcao: "in" | "out";
  atendida: boolean;
  estado: string | null;
  duracaoS: number | null;
  esperaS: number | null;
  agenteId: string | null;
  agenteNome: string | null;
  clienteNumero: string | null;
  equipa: EquipaAnalise;
}

export interface Totais {
  recebidas: number;
  recebidasAtendidas: number;
  feitas: number;
  feitasAtendidas: number;
  /** % of inbound calls a person answered, or null with no inbound calls. */
  atendidasPct: number | null;
  esperaMediaS: number | null;
  duracaoMediaS: number | null;
}

export interface VisaoGeral {
  de: string;
  ate: string;
  equipa: FiltroEquipa;
  kpis: Totais & {
    /** Distinct customers who called in. */
    clientes: number;
    /** % of those customers who called 3 or more times in the period. */
    clientesInsistentesPct: number | null;
    /** % of outbound calls that became a real conversation (answered, over 30 s). */
    conversasReaisPct: number | null;
  };
  porDia: { dia: string; recebidas: number; feitas: number; recebidasAtendidas: number }[];
  porHora: { hora: number; recebidas: number; atendidas: number; pct: number | null }[];
  resultadosRecebidas: { id: "atendidas" | "caixa_voz" | "nao_atendidas"; nome: string; total: number; pct: number | null }[];
  porEquipa: ({ id: EquipaAnalise; nome: string } & Totais)[];
  porColaborador: ({ agenteId: string; nome: string; equipa: EquipaAnalise } & Totais)[];
}

export const NOMES_EQUIPA: Record<EquipaAnalise, string> = {
  "360": "Equipa 360 (com Sinistros)",
  vida: "Equipa Vida",
  corporate: "Corporate e restantes",
  sem_agente: "Sem pessoa atribuída",
};

/** A real outbound conversation lasts more than this (same rule as the Vida prototype). */
export const CONVERSA_REAL_MIN_S = 30;

/** A customer who calls this many times or more in the period is "insistent". */
export const CHAMADAS_INSISTENTE = 3;

function pct(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

export function totais(chamadas: readonly ChamadaParaAgregar[]): Totais {
  let recebidas = 0;
  let recebidasAtendidas = 0;
  let feitas = 0;
  let feitasAtendidas = 0;
  const esperas: number[] = [];
  const duracoes: number[] = [];
  for (const c of chamadas) {
    if (c.direcao === "in") {
      recebidas++;
      if (c.atendida) recebidasAtendidas++;
      if (c.atendida && c.esperaS != null) esperas.push(c.esperaS);
    } else {
      feitas++;
      if (c.atendida) feitasAtendidas++;
    }
    if (c.atendida && c.duracaoS != null) duracoes.push(c.duracaoS);
  }
  return {
    recebidas,
    recebidasAtendidas,
    feitas,
    feitasAtendidas,
    atendidasPct: pct(recebidasAtendidas, recebidas),
    esperaMediaS: media(esperas),
    duracaoMediaS: media(duracoes),
  };
}

function eCaixaDeVoz(estado: string | null): boolean {
  return estado != null && /voicemail|messag/i.test(estado);
}

/** Every weekday in [de, ate], plus any weekend day that had calls. */
function diasDoPeriodo(de: string, ate: string, comChamadas: ReadonlySet<string>): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const w = diaDaSemana(d);
    if ((w !== 0 && w !== 6) || comChamadas.has(d)) dias.push(d);
  }
  return dias;
}

export function agregarVisaoGeral(
  todas: readonly ChamadaParaAgregar[],
  de: string,
  ate: string,
  equipa: FiltroEquipa,
): VisaoGeral {
  const chamadas = equipa === "todas" ? todas : todas.filter((c) => c.equipa === equipa);

  // KPIs
  const t = totais(chamadas);
  const porCliente = new Map<string, number>();
  for (const c of chamadas) {
    if (c.direcao !== "in" || !c.clienteNumero) continue;
    porCliente.set(c.clienteNumero, (porCliente.get(c.clienteNumero) ?? 0) + 1);
  }
  const insistentes = [...porCliente.values()].filter((n) => n >= CHAMADAS_INSISTENTE).length;
  const conversasReais = chamadas.filter(
    (c) => c.direcao === "out" && c.atendida && (c.duracaoS ?? 0) > CONVERSA_REAL_MIN_S,
  ).length;

  // Por dia
  const dia = new Map<string, { recebidas: number; feitas: number; recebidasAtendidas: number }>();
  for (const c of chamadas) {
    const d = dia.get(c.dia) ?? { recebidas: 0, feitas: 0, recebidasAtendidas: 0 };
    if (c.direcao === "in") {
      d.recebidas++;
      if (c.atendida) d.recebidasAtendidas++;
    } else d.feitas++;
    dia.set(c.dia, d);
  }
  const porDia = diasDoPeriodo(de, ate, new Set(dia.keys())).map((d) => ({
    dia: d,
    ...(dia.get(d) ?? { recebidas: 0, feitas: 0, recebidasAtendidas: 0 }),
  }));

  // Por hora (recebidas) — always 8h–19h, wider when calls fall outside.
  const hora = new Map<number, { recebidas: number; atendidas: number }>();
  for (const c of chamadas) {
    if (c.direcao !== "in") continue;
    const h = hora.get(c.hora) ?? { recebidas: 0, atendidas: 0 };
    h.recebidas++;
    if (c.atendida) h.atendidas++;
    hora.set(c.hora, h);
  }
  const horas = [...hora.keys()];
  const hMin = Math.min(8, ...horas);
  const hMax = Math.max(19, ...horas);
  const porHora = [];
  for (let h = hMin; h <= hMax; h++) {
    const v = hora.get(h) ?? { recebidas: 0, atendidas: 0 };
    porHora.push({ hora: h, ...v, pct: pct(v.atendidas, v.recebidas) });
  }

  // O que acontece às recebidas
  const recebidas = chamadas.filter((c) => c.direcao === "in");
  const atendidas = recebidas.filter((c) => c.atendida).length;
  const caixaVoz = recebidas.filter((c) => !c.atendida && eCaixaDeVoz(c.estado)).length;
  const naoAtendidas = recebidas.length - atendidas - caixaVoz;
  const resultadosRecebidas = [
    { id: "atendidas" as const, nome: "Atendidas por uma pessoa", total: atendidas, pct: pct(atendidas, recebidas.length) },
    { id: "caixa_voz" as const, nome: "Caixa de voz", total: caixaVoz, pct: pct(caixaVoz, recebidas.length) },
    { id: "nao_atendidas" as const, nome: "Não atendidas", total: naoAtendidas, pct: pct(naoAtendidas, recebidas.length) },
  ];

  // Por equipa — always every team, so the table works as a comparison.
  const ordemEquipas: EquipaAnalise[] = ["360", "vida", "corporate", "sem_agente"];
  const porEquipa = ordemEquipas
    .map((id) => ({ id, nome: NOMES_EQUIPA[id], ...totais(todas.filter((c) => c.equipa === id)) }))
    .filter((e) => e.id !== "sem_agente" || e.recebidas + e.feitas > 0);

  // Por colaborador (within the filter)
  const porAgente = new Map<string, ChamadaParaAgregar[]>();
  for (const c of chamadas) {
    if (!c.agenteId) continue;
    const l = porAgente.get(c.agenteId) ?? [];
    l.push(c);
    porAgente.set(c.agenteId, l);
  }
  const porColaborador = [...porAgente.entries()]
    .map(([agenteId, l]) => ({
      agenteId,
      nome: l.find((c) => c.agenteNome)?.agenteNome ?? `Utilizador ${agenteId}`,
      equipa: l[0].equipa,
      ...totais(l),
    }))
    .sort((a, b) => b.recebidas + b.feitas - (a.recebidas + a.feitas) || a.nome.localeCompare(b.nome, "pt"));

  return {
    de,
    ate,
    equipa,
    kpis: {
      ...t,
      clientes: porCliente.size,
      clientesInsistentesPct: pct(insistentes, porCliente.size),
      conversasReaisPct: pct(conversasReais, t.feitas),
    },
    porDia,
    porHora,
    resultadosRecebidas,
    porEquipa,
    porColaborador,
  };
}
