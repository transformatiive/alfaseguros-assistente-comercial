import { describe, it, expect } from "vitest";
import {
  computeCategoryStats,
  computeAllCategoryStats,
  tendencia,
  type PointEvaluation,
} from "./category-stats.js";

function ev(p: Partial<PointEvaluation> & { estado: PointEvaluation["estado"] }): PointEvaluation {
  return {
    conversationId: p.conversationId ?? 1,
    colaboradorId: p.colaboradorId ?? null,
    categoryId: p.categoryId ?? 10,
    itemId: p.itemId ?? 100,
    estado: p.estado,
  };
}

describe("computeCategoryStats", () => {
  it("excludes nao_aplicavel and indeterminado from the denominator", () => {
    const s = computeCategoryStats(10, [
      ev({ estado: "cumprido", itemId: 1, conversationId: 1 }),
      ev({ estado: "nao_cumprido", itemId: 2, conversationId: 1 }),
      ev({ estado: "nao_aplicavel", itemId: 3, conversationId: 1 }),
      ev({ estado: "indeterminado", itemId: 4, conversationId: 1 }),
    ]);
    expect(s.aplicavel).toBe(2);
    expect(s.taxa).toBeCloseTo(0.5);
    expect(s.absoluto).toBe("1 de 2");
  });

  it("counts coverage as distinct calls with >=1 applicable point", () => {
    const s = computeCategoryStats(10, [
      ev({ estado: "cumprido", conversationId: 1 }),
      ev({ estado: "nao_cumprido", conversationId: 1 }),
      ev({ estado: "cumprido", conversationId: 2 }),
      ev({ estado: "nao_aplicavel", conversationId: 3 }), // not applicable -> no coverage
    ]);
    expect(s.cobertura).toBe(2);
  });

  it("hides an isolated % below the threshold but always gives the absolute (R4)", () => {
    const s = computeCategoryStats(
      10,
      [
        ev({ estado: "cumprido", conversationId: 1 }),
        ev({ estado: "nao_cumprido", conversationId: 2 }),
      ],
      { minChamadas: 5 },
    );
    expect(s.cobertura).toBe(2);
    expect(s.exibePercentagem).toBe(false);
    expect(s.absoluto).toBe("1 de 2");
  });

  it("shows the % once coverage reaches the threshold", () => {
    const evals: PointEvaluation[] = [];
    for (let c = 1; c <= 5; c++) evals.push(ev({ estado: "cumprido", conversationId: c }));
    const s = computeCategoryStats(10, evals, { minChamadas: 5 });
    expect(s.exibePercentagem).toBe(true);
    expect(s.taxa).toBe(1);
  });

  it("returns taxa null when there is no applicable point", () => {
    const s = computeCategoryStats(10, [
      ev({ estado: "indeterminado" }),
      ev({ estado: "nao_aplicavel" }),
    ]);
    expect(s.taxa).toBeNull();
    expect(s.exibePercentagem).toBe(false);
  });

  it("identifies the weakest point, breaking ties by lowest id", () => {
    const s = computeCategoryStats(10, [
      ev({ estado: "cumprido", itemId: 1 }),
      ev({ estado: "nao_cumprido", itemId: 2 }),
      ev({ estado: "nao_cumprido", itemId: 3 }),
    ]);
    // item 2 and 3 both 0% — tie resolves to the lower id (2).
    expect(s.pontoMaisFraco?.itemId).toBe(2);
    expect(s.pontoMaisFraco?.taxa).toBe(0);
  });

  it("computes operator dispersion only with >=2 operators", () => {
    const one = computeCategoryStats(10, [ev({ estado: "cumprido", colaboradorId: 1 })]);
    expect(one.dispersaoColaboradores).toBeNull();

    const two = computeCategoryStats(10, [
      ev({ estado: "cumprido", colaboradorId: 1, itemId: 1 }),
      ev({ estado: "nao_cumprido", colaboradorId: 2, itemId: 1 }),
    ]);
    // rates [1, 0] -> population stddev 0.5
    expect(two.dispersaoColaboradores).toBeCloseTo(0.5);
  });
});

describe("computeAllCategoryStats", () => {
  it("groups evaluations by category", () => {
    const out = computeAllCategoryStats([
      ev({ categoryId: 20, estado: "cumprido" }),
      ev({ categoryId: 10, estado: "nao_cumprido" }),
    ]);
    expect(out.map((c) => c.categoryId)).toEqual([10, 20]);
  });
});

describe("tendencia", () => {
  it("classifies direction and is null when a rate is missing", () => {
    expect(tendencia(0.8, 0.6)?.direcao).toBe("subiu");
    expect(tendencia(0.5, 0.7)?.direcao).toBe("desceu");
    expect(tendencia(0.5, 0.5)?.direcao).toBe("estavel");
    expect(tendencia(null, 0.5)).toBeNull();
    expect(tendencia(0.5, null)).toBeNull();
  });
});
