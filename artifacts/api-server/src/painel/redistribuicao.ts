/**
 * Rule-based redistribution suggestion for the supervisor's team view.
 *
 * Deliberately NOT an LLM call. The spec requires it, and the reasons are
 * sound: this runs on every team-view load, it must be free, instant, and
 * identical for the same input — a supervisor who reloads and gets different
 * advice stops trusting the advice. The reasoning is assembled from the same
 * numbers shown on screen, so the supervisor can check it by eye.
 */

export interface CargaAgente {
  colaboradorId: number;
  nome: string;
  devolucoes: number;
  ticketsEmRisco: number;
  followUps: number;
}

/**
 * Weights reflect how much attention one item of each kind demands, not how
 * important it is. A missed call is a short call back; a ticket open past 24
 * hours usually needs reading a history and writing a reply.
 */
export const PESOS = { devolucoes: 1, ticketsEmRisco: 2, followUps: 1.5 } as const;

/** Threshold above the median at which an agent counts as overloaded. */
export const LIMIAR_SOBRECARGA = 1.5;

export interface Sugestao {
  /** null when no redistribution is warranted. */
  de: { colaboradorId: number; nome: string } | null;
  para: { colaboradorId: number; nome: string } | null;
  /** Plain Portuguese, naming the agents and the counts it rests on. */
  razao: string;
}

export function cargaPonderada(c: CargaAgente): number {
  return (
    c.devolucoes * PESOS.devolucoes +
    c.ticketsEmRisco * PESOS.ticketsEmRisco +
    c.followUps * PESOS.followUps
  );
}

/** Median of a numeric list. Even-length lists average the two middle values. */
export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 === 1 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
}

function n(valor: number): string {
  // Weights produce halves; show them only when they exist.
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
}

/**
 * Suggest moving work from the most loaded agent to the least loaded one, but
 * only when the imbalance is real.
 *
 * Every "no suggestion" path returns a sentence explaining why, rather than an
 * empty string: a supervisor looking at a quiet day should read "the team is
 * balanced", not wonder whether the feature is broken.
 */
export function sugerirRedistribuicao(cargas: readonly CargaAgente[]): Sugestao {
  const semSugestao = (razao: string): Sugestao => ({ de: null, para: null, razao });

  if (cargas.length === 0) {
    return semSugestao("Não há agentes ativos na equipa 360 para comparar.");
  }
  if (cargas.length === 1) {
    return semSugestao(
      `Só ${cargas[0].nome} tem trabalho atribuído hoje — não há para quem redistribuir.`,
    );
  }

  const comCarga = cargas.map((c) => ({ ...c, carga: cargaPonderada(c) }));
  const total = comCarga.reduce((s, c) => s + c.carga, 0);
  if (total === 0) {
    return semSugestao("Ninguém tem trabalho pendente hoje. Nada a redistribuir.");
  }

  const med = mediana(comCarga.map((c) => c.carga));

  // Ties are broken by colaborador id so the same input always yields the same
  // suggestion. Without this, two equally loaded agents would swap places
  // between reloads and the advice would look arbitrary.
  const ordenado = [...comCarga].sort(
    (a, b) => b.carga - a.carga || a.colaboradorId - b.colaboradorId,
  );
  const maisCarregado = ordenado[0];
  const menosCarregado = ordenado[ordenado.length - 1];

  if (med === 0) {
    // Median zero means most of the team is idle while someone is not: the
    // ratio test would divide by zero, but the imbalance is real.
    return {
      de: { colaboradorId: maisCarregado.colaboradorId, nome: maisCarregado.nome },
      para: { colaboradorId: menosCarregado.colaboradorId, nome: menosCarregado.nome },
      razao:
        `${maisCarregado.nome} tem ${n(maisCarregado.carga)} pontos de carga e a mediana da equipa ` +
        `é zero — a maioria dos agentes não tem nada pendente. ` +
        `${menosCarregado.nome} está livre e pode assumir os itens mais antigos.`,
    };
  }

  if (maisCarregado.carga <= med * LIMIAR_SOBRECARGA) {
    return semSugestao(
      `A equipa está equilibrada. A carga mais alta é a de ${maisCarregado.nome}, ` +
        `com ${n(maisCarregado.carga)} pontos, abaixo de ${n(med * LIMIAR_SOBRECARGA)} — ` +
        `${LIMIAR_SOBRECARGA}× a mediana de ${n(med)}.`,
    );
  }

  if (maisCarregado.colaboradorId === menosCarregado.colaboradorId) {
    return semSugestao("Não há dois agentes distintos para comparar.");
  }

  return {
    de: { colaboradorId: maisCarregado.colaboradorId, nome: maisCarregado.nome },
    para: { colaboradorId: menosCarregado.colaboradorId, nome: menosCarregado.nome },
    razao:
      `${maisCarregado.nome} tem ${n(maisCarregado.carga)} pontos de carga ` +
      `(${maisCarregado.devolucoes} por devolver, ${maisCarregado.ticketsEmRisco} tickets em risco, ` +
      `${maisCarregado.followUps} follow-ups), mais de ${LIMIAR_SOBRECARGA}× a mediana da equipa, ` +
      `que é ${n(med)}. ${menosCarregado.nome} tem ${n(menosCarregado.carga)}. ` +
      `Sugestão: passar os itens mais antigos de ${maisCarregado.nome} para ${menosCarregado.nome}.`,
  };
}
