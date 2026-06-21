import { ESTADOS } from "@workspace/db/schema";

/** cumprido | nao_cumprido | nao_aplicavel | indeterminado */
export type Estado = (typeof ESTADOS)[number];

/** Default coverage threshold below which a % must not be shown in isolation (spec §3, R4). */
export const MIN_CHAMADAS_PADRAO_DEFAULT = 5;

/** One evaluated point on one call. The unit the aggregation consumes. */
export interface PointEvaluation {
  conversationId: number;
  colaboradorId: number | null;
  categoryId: number;
  itemId: number;
  estado: Estado;
}

/** Only cumprido / nao_cumprido count toward a rate (R2 denominator rule). */
export function isApplicable(estado: Estado): boolean {
  return estado === "cumprido" || estado === "nao_cumprido";
}

/** Compliance rate over applicable points; null when there is no applicable point. */
export function complianceRate(cumprido: number, aplicavel: number): number | null {
  if (aplicavel <= 0) return null;
  return cumprido / aplicavel;
}

export interface WeakestPoint {
  itemId: number;
  taxa: number;
  cumprido: number;
  aplicavel: number;
}

export interface CategoryStats {
  categoryId: number;
  cumprido: number;
  naoCumprido: number;
  naoAplicavel: number;
  indeterminado: number;
  /** cumprido + naoCumprido — the denominator. */
  aplicavel: number;
  /** Distinct calls where the category had ≥1 applicable point. */
  cobertura: number;
  /** cumprido / aplicavel, or null when aplicavel === 0. */
  taxa: number | null;
  /**
   * Honesty guardrail (R4): only true when coverage ≥ threshold AND a rate
   * exists. The UI must show {@link absoluto} instead of an isolated % when false.
   */
  exibePercentagem: boolean;
  /** Always-safe absolute, e.g. "3 de 4". */
  absoluto: string;
  /** Weakest point (lowest rate) within the category; null if none applicable. */
  pontoMaisFraco: WeakestPoint | null;
  /** Population stddev of per-operator rates; null with fewer than 2 operators. */
  dispersaoColaboradores: number | null;
}

export interface CategoryStatsOptions {
  /** Coverage threshold for the honesty rule. Defaults to {@link MIN_CHAMADAS_PADRAO_DEFAULT}. */
  minChamadas?: number;
}

function populationStdDev(values: number[]): number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/** Weakest point within a single category's evaluations. */
function weakestPoint(evals: PointEvaluation[]): WeakestPoint | null {
  const byItem = new Map<number, { cumprido: number; aplicavel: number }>();
  for (const e of evals) {
    if (!isApplicable(e.estado)) continue;
    const acc = byItem.get(e.itemId) ?? { cumprido: 0, aplicavel: 0 };
    acc.aplicavel += 1;
    if (e.estado === "cumprido") acc.cumprido += 1;
    byItem.set(e.itemId, acc);
  }
  let worst: WeakestPoint | null = null;
  // Deterministic: iterate item ids ascending so ties resolve to the lowest id.
  for (const itemId of [...byItem.keys()].sort((a, b) => a - b)) {
    const { cumprido, aplicavel } = byItem.get(itemId)!;
    const taxa = cumprido / aplicavel;
    if (worst === null || taxa < worst.taxa) {
      worst = { itemId, taxa, cumprido, aplicavel };
    }
  }
  return worst;
}

/** Per-operator compliance rates within a category (operators with ≥1 applicable). */
function operatorRates(evals: PointEvaluation[]): number[] {
  const byOp = new Map<number, { cumprido: number; aplicavel: number }>();
  for (const e of evals) {
    if (e.colaboradorId == null || !isApplicable(e.estado)) continue;
    const acc = byOp.get(e.colaboradorId) ?? { cumprido: 0, aplicavel: 0 };
    acc.aplicavel += 1;
    if (e.estado === "cumprido") acc.cumprido += 1;
    byOp.set(e.colaboradorId, acc);
  }
  return [...byOp.values()].filter((v) => v.aplicavel > 0).map((v) => v.cumprido / v.aplicavel);
}

/** Aggregate one category from its point evaluations. */
export function computeCategoryStats(
  categoryId: number,
  evals: PointEvaluation[],
  opts: CategoryStatsOptions = {},
): CategoryStats {
  const minChamadas = opts.minChamadas ?? MIN_CHAMADAS_PADRAO_DEFAULT;

  let cumprido = 0;
  let naoCumprido = 0;
  let naoAplicavel = 0;
  let indeterminado = 0;
  const coveredCalls = new Set<number>();

  for (const e of evals) {
    switch (e.estado) {
      case "cumprido":
        cumprido += 1;
        coveredCalls.add(e.conversationId);
        break;
      case "nao_cumprido":
        naoCumprido += 1;
        coveredCalls.add(e.conversationId);
        break;
      case "nao_aplicavel":
        naoAplicavel += 1;
        break;
      case "indeterminado":
        indeterminado += 1;
        break;
    }
  }

  const aplicavel = cumprido + naoCumprido;
  const taxa = complianceRate(cumprido, aplicavel);
  const cobertura = coveredCalls.size;
  const rates = operatorRates(evals);

  return {
    categoryId,
    cumprido,
    naoCumprido,
    naoAplicavel,
    indeterminado,
    aplicavel,
    cobertura,
    taxa,
    exibePercentagem: taxa !== null && cobertura >= minChamadas,
    absoluto: `${cumprido} de ${aplicavel}`,
    pontoMaisFraco: weakestPoint(evals),
    dispersaoColaboradores: rates.length >= 2 ? populationStdDev(rates) : null,
  };
}

/** Aggregate every category present in the evaluations, keyed by categoryId. */
export function computeAllCategoryStats(
  evals: PointEvaluation[],
  opts: CategoryStatsOptions = {},
): CategoryStats[] {
  const byCategory = new Map<number, PointEvaluation[]>();
  for (const e of evals) {
    const list = byCategory.get(e.categoryId) ?? [];
    list.push(e);
    byCategory.set(e.categoryId, list);
  }
  return [...byCategory.keys()]
    .sort((a, b) => a - b)
    .map((categoryId) => computeCategoryStats(categoryId, byCategory.get(categoryId)!, opts));
}

export interface Tendencia {
  /** current − previous, in rate points (e.g. 0.1 = +10pp). */
  delta: number;
  direcao: "subiu" | "desceu" | "estavel";
}

/**
 * Trend vs a previous period. Returns null when either rate is unavailable
 * (so the UI shows no trend rather than a misleading one) — aligns with R5's
 * ban on asserting trends without enough signal.
 */
export function tendencia(atual: number | null, anterior: number | null): Tendencia | null {
  if (atual === null || anterior === null) return null;
  const delta = atual - anterior;
  const direcao = Math.abs(delta) < 1e-9 ? "estavel" : delta > 0 ? "subiu" : "desceu";
  return { delta, direcao };
}
