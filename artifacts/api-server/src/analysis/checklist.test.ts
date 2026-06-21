import { describe, it, expect } from "vitest";
import { checklistAnalysisSchema } from "./checklist-schema.js";
import { reconcileChecklistResults } from "./checklist-analyzer.js";
import type { ChecklistItemForPrompt } from "./checklist-prompt.js";

const items: ChecklistItemForPrompt[] = [
  { id: 1, categoria: "Apresentação", validacao: "Apresentei-me?", texto: "Disse o nome e a empresa?", condicional: false, condicaoDescricao: null },
  { id: 2, categoria: "Apresentação", validacao: "Gravação", texto: "Pedi autorização de gravação?", condicional: false, condicaoDescricao: null },
  { id: 3, categoria: "Simulação", validacao: "Preenchi a Proposta?", texto: "Avancei para o preenchimento?", condicional: true, condicaoDescricao: "O cliente aceitou avançar." },
];

describe("checklistAnalysisSchema", () => {
  it("parses a well-formed response", () => {
    const out = checklistAnalysisSchema.parse({
      faseDetectada: "primeiro_contacto",
      resultados: [
        { itemId: 1, estado: "cumprido", evidencia: "Apresentou-se como Rute da Alfaseguros." },
        { itemId: 2, estado: "nao_cumprido", evidencia: "Não pediu autorização." },
      ],
    });
    expect(out.faseDetectada).toBe("primeiro_contacto");
    expect(out.resultados).toHaveLength(2);
  });

  it("is lenient: invalid estado falls back to indeterminado, missing evidencia to ''", () => {
    const out = checklistAnalysisSchema.parse({
      faseDetectada: "primeiro_contacto",
      resultados: [{ itemId: 1, estado: "talvez" }],
    });
    expect(out.resultados[0].estado).toBe("indeterminado");
    expect(out.resultados[0].evidencia).toBe("");
  });

  it("defaults an unknown fase to primeiro_contacto", () => {
    const out = checklistAnalysisSchema.parse({ faseDetectada: "qualquer", resultados: [] });
    expect(out.faseDetectada).toBe("primeiro_contacto");
  });
});

describe("reconcileChecklistResults", () => {
  it("fills omitted items with indeterminado, preserving applicable order", () => {
    const out = reconcileChecklistResults(items, [
      { itemId: 1, estado: "cumprido", evidencia: "ok" },
    ]);
    expect(out.map((r) => r.itemId)).toEqual([1, 2, 3]);
    expect(out[0].estado).toBe("cumprido");
    expect(out[1].estado).toBe("indeterminado");
    expect(out[2].estado).toBe("indeterminado");
  });

  it("drops results for unknown (hallucinated) item ids", () => {
    const out = reconcileChecklistResults(items, [
      { itemId: 999, estado: "cumprido", evidencia: "x" },
      { itemId: 2, estado: "cumprido", evidencia: "y" },
    ]);
    expect(out.find((r) => r.itemId === 999)).toBeUndefined();
    expect(out.find((r) => r.itemId === 2)?.estado).toBe("cumprido");
  });

  it("de-duplicates repeated ids (first wins)", () => {
    const out = reconcileChecklistResults(items, [
      { itemId: 1, estado: "cumprido", evidencia: "first" },
      { itemId: 1, estado: "nao_cumprido", evidencia: "second" },
    ]);
    const one = out.filter((r) => r.itemId === 1);
    expect(one).toHaveLength(1);
    expect(one[0].estado).toBe("cumprido");
  });

  it("preserves nao_aplicavel for a conditional point whose condition didn't occur", () => {
    const out = reconcileChecklistResults(items, [
      { itemId: 3, estado: "nao_aplicavel", evidencia: "" },
    ]);
    expect(out.find((r) => r.itemId === 3)?.estado).toBe("nao_aplicavel");
  });
});
