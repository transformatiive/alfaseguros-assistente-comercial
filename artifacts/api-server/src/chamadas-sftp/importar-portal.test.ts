import { describe, expect, it } from "vitest";
import { converterChamadaPortal, exportPortalSchema } from "./importar-portal.js";
import { eGravacao } from "../jobs/chamadas-sftp.js";

const base = {
  id: "2026_10_27_10_15_00_351911111111_abc",
  ficheiro: "shared/2026_10_27_10_15_00_351911111111_abc.mp3",
  dataHora: Date.parse("2026-10-27T10:15:00Z"),
  telefone: "351911111111",
  tamanhoBytes: 400000,
  duracaoS: 182.5,
  estado: "analisada",
  colaborador: "Colaborador Vida",
  tipo: "primeiro",
  resumo: "Cliente com crédito no banco X aceitou simulação.",
  desfecho: "proposta",
  objecoes: ["banco", "inventada"],
  motivoDescarte: null,
  erro: null,
  modelo: "anthropic/claude-sonnet-5.5",
  custoUsd: 0.0123,
  analisadaEm: Date.parse("2026-10-28T03:00:00Z"),
  resultados: [
    { item: "primeiro.apresentacao", estado: "cumprido", confianca: 0.9, rever: false, evidencia: "Apresentou-se." },
    { item: "primeiro.preco", estado: "nao_cumprido", confianca: 0.4, rever: true, evidencia: "" },
    { item: "lixo", estado: "talvez" },
  ],
};

describe("converterChamadaPortal", () => {
  it("keeps an analysed call as it was, with its points, without asking the model again", () => {
    const c = converterChamadaPortal(base)!;
    expect(c.linha).toMatchObject({
      ficheiro: base.ficheiro,
      estado: "analisada",
      tipo: "primeiro",
      desfecho: "proposta",
      duracaoS: 182.5,
      custoUsd: 0.0123,
      modelo: "anthropic/claude-sonnet-5.5",
    });
    expect(c.linha.dataHora.toISOString()).toBe("2026-10-27T10:15:00.000Z");
    expect(c.linha.objecoes).toEqual(["banco", "outra"]);
    expect(c.resultados).toEqual([
      { item: "primeiro.apresentacao", estado: "cumprido", confianca: 0.9, rever: false, evidencia: "Apresentou-se." },
      { item: "primeiro.preco", estado: "nao_cumprido", confianca: 0.4, rever: true, evidencia: null },
    ]);
  });

  it("an analysed call with no valid type comes back as error, to be analysed again", () => {
    const c = converterChamadaPortal({ ...base, tipo: "outro" })!;
    expect(c.linha.estado).toBe("erro");
    expect(c.linha.tipo).toBeNull();
    expect(c.resultados).toEqual([]);
  });

  it("discarded and pending calls carry no points", () => {
    const d = converterChamadaPortal({ ...base, estado: "descartada", motivoDescarte: "Caixa de correio" })!;
    expect(d.linha).toMatchObject({ estado: "descartada", tipo: null, motivoDescarte: "Caixa de correio" });
    expect(d.resultados).toEqual([]);
    const p = converterChamadaPortal({ ...base, estado: "pendente", analisadaEm: null })!;
    expect(p.linha.analisadaEm).toBeNull();
  });

  it("rejects entries without file, date or a known state", () => {
    expect(converterChamadaPortal({ ...base, ficheiro: "" })).toBeNull();
    expect(converterChamadaPortal({ ...base, dataHora: "ontem" })).toBeNull();
    expect(converterChamadaPortal({ ...base, estado: "estranho" })).toBeNull();
    expect(converterChamadaPortal(null)).toBeNull();
  });
});

describe("exportPortalSchema", () => {
  it("accepts the portal export with or without highlights", () => {
    expect(exportPortalSchema.safeParse({ chamadas: [base], destaques: null }).success).toBe(true);
    expect(
      exportPortalSchema.safeParse({ chamadas: [], destaques: { periodoDe: "2026-10-22", periodoAte: "2026-10-28", geradoEm: 1, modelo: "m", destaques: [] } })
        .success,
    ).toBe(true);
    expect(exportPortalSchema.safeParse({}).success).toBe(false);
  });
});

describe("eGravacao", () => {
  it("campaign recordings only: mp3 in shared/, not the upload inbox, not Corporate", () => {
    expect(eGravacao("shared/2026_10_27_x.mp3")).toBe(true);
    expect(eGravacao("shared/Vida_2026_10_27_x.MP3")).toBe(true);
    expect(eGravacao("shared/upload/2026_10_27_x.mp3")).toBe(false);
    expect(eGravacao("shared/Corporate_2026_10_27_x.mp3")).toBe(false);
    expect(eGravacao("shared/relatorio.pdf")).toBe(false);
  });
});
