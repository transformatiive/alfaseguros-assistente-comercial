import { describe, expect, it } from "vitest";
import { agregarEquipa360, chaveFalha, type ConversaPara360 } from "./agregar-360.js";
import type { EquipaColaborador } from "./agregar.js";

const roster = new Map<string, EquipaColaborador>([
  ["10", "360"],
  ["11", "sinistros"],
  ["20", "vida"],
]);

function analise(o: Record<string, unknown> = {}) {
  return {
    categoria: "Cotação",
    produto: "Auto",
    narrativaConversa: "n",
    arcoConversa: "a",
    sentimentoClienteEvolucao: "s",
    qualidadeGlobal: 4,
    continuidade: "c",
    desviosProcedimento: [],
    pontosPositivos: [],
    feedbackSupervisor: "f",
    sugestaoEspecialista: "e",
    followUpNecessario: false,
    followUpDescricao: "",
    riscoPerdaLead: "baixo",
    tags: [],
    ...o,
  };
}

let seq = 0;
function conv(o: Partial<ConversaPara360> = {}): ConversaPara360 {
  seq += 1;
  return {
    id: seq,
    dia: "2026-10-27",
    agenteId: "10",
    agenteNome: "Tiago Paiva",
    analise: analise(),
    resultado: "open",
    temTicket: true,
    ...o,
  };
}

const desvio = (titulo: string, severidade = "media") => ({ severidade, titulo, detalhe: "d", chamadaEspecifica: null });

describe("chaveFalha", () => {
  it("groups the same deviation written with accents, case, articles or a full stop", () => {
    expect(chaveFalha("Não confirmou o NIF.")).toBe(chaveFalha("nao confirmou NIF"));
  });
});

describe("agregarEquipa360", () => {
  it("keeps only 360 (Sinistros included), drops Vida and unknown agents", () => {
    const v = agregarEquipa360(
      [conv(), conv({ agenteId: "11", agenteNome: "Tânia" }), conv({ agenteId: "20" }), conv({ agenteId: "99", agenteNome: "X" })],
      roster,
      "2026-10-01",
      "2026-10-30",
    );
    expect(v.kpis.conversas).toBe(2);
    expect(v.porColaborador.map((p) => p.agenteId).sort()).toEqual(["10", "11"]);
  });

  it("invalid or missing analysis counts as a conversation but not as analysed", () => {
    const v = agregarEquipa360([conv(), conv({ analise: null }), conv({ analise: { qualidadeGlobal: 9 } })], roster, "a", "b");
    expect(v.kpis.conversas).toBe(3);
    expect(v.kpis.analisadas).toBe(1);
    expect(v.kpis.qualidadeMedia).toBe(4);
  });

  it("KPIs: quality average, high deviations, no ticket, risk, follow-up", () => {
    const v = agregarEquipa360(
      [
        conv({ analise: analise({ qualidadeGlobal: 2, desviosProcedimento: [desvio("Sem NIF", "alta")], riscoPerdaLead: "alto", followUpNecessario: true }) }),
        conv({ analise: analise({ qualidadeGlobal: 5 }), temTicket: false, resultado: null }),
        conv({ analise: analise({ qualidadeGlobal: 4 }), resultado: "won" }),
        conv({ analise: analise({ qualidadeGlobal: 3 }), resultado: "lost" }),
      ],
      roster,
      "a",
      "b",
    );
    expect(v.kpis.qualidadeMedia).toBe(3.5);
    expect(v.kpis.comDesvioAltoPct).toBe(25);
    expect(v.kpis.semTicketPct).toBe(25);
    expect(v.kpis.riscoAltoPct).toBe(25);
    expect(v.kpis.followUpPct).toBe(25);
    const r = Object.fromEntries(v.resultados.map((x) => [x.id, x.conversas]));
    expect(r).toEqual({ won: 1, lost: 1, open: 1, unknown: 0, sem_ticket: 1 });
  });

  it("deviations: counted once per conversation, grouped, highest severity kept, sorted", () => {
    const v = agregarEquipa360(
      [
        conv({ analise: analise({ desviosProcedimento: [desvio("Não confirmou o NIF."), desvio("nao confirmou NIF", "alta")] }) }),
        conv({ analise: analise({ desviosProcedimento: [desvio("Não confirmou o NIF")] }) }),
        conv({ analise: analise({ desviosProcedimento: [desvio("Sem próximo passo")] }) }),
        conv(),
      ],
      roster,
      "a",
      "b",
    );
    expect(v.falhas[0]).toEqual({ titulo: "Não confirmou o NIF", conversas: 2, pct: 50, severidade: "alta" });
    expect(v.falhas[1].titulo).toBe("Sem próximo passo");
  });

  it("reasons: top categories plus 'Outros motivos'", () => {
    const cats = ["A", "B", "C", "D", "E", "F", "G", "G"];
    const v = agregarEquipa360(cats.map((c) => conv({ analise: analise({ categoria: c }) })), roster, "a", "b");
    expect(v.motivos[0]).toMatchObject({ nome: "G", conversas: 2 });
    expect(v.motivos).toHaveLength(7);
    expect(v.motivos[6]).toMatchObject({ nome: "Outros motivos", conversas: 1 });
    expect(v.motivos.reduce((s, m) => s + m.conversas, 0)).toBe(cats.length);
  });

  it("worst conversations: only quality 3 or less, lowest first, at most 5", () => {
    const v = agregarEquipa360(
      [1, 5, 3, 2, 1, 2, 3, 4].map((q) => conv({ analise: analise({ qualidadeGlobal: q }) })),
      roster,
      "a",
      "b",
    );
    expect(v.piores.map((p) => p.qualidade)).toEqual([1, 1, 2, 2, 3]);
  });

  it("empty period: zeros and nulls, no NaN", () => {
    const v = agregarEquipa360([], roster, "a", "b");
    expect(v.kpis).toEqual({
      conversas: 0,
      analisadas: 0,
      qualidadeMedia: null,
      comDesvioAltoPct: null,
      semTicketPct: null,
      riscoAltoPct: null,
      followUpPct: null,
    });
    expect(v.falhas).toEqual([]);
    expect(v.piores).toEqual([]);
  });
});
