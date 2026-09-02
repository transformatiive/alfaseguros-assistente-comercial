import { describe, it, expect } from "vitest";
import {
  sugerirRedistribuicao,
  cargaPonderada,
  mediana,
  PESOS,
  LIMIAR_SOBRECARGA,
  type CargaAgente,
} from "./redistribuicao.js";

function agente(over: Partial<CargaAgente> & { colaboradorId: number }): CargaAgente {
  return {
    nome: `Agente ${over.colaboradorId}`,
    devolucoes: 0,
    ticketsEmRisco: 0,
    followUps: 0,
    ...over,
  };
}

describe("cargaPonderada", () => {
  it("weights a ticket at twice a call and a follow-up at one and a half", () => {
    expect(cargaPonderada(agente({ colaboradorId: 1, devolucoes: 1 }))).toBe(1);
    expect(cargaPonderada(agente({ colaboradorId: 1, ticketsEmRisco: 1 }))).toBe(2);
    expect(cargaPonderada(agente({ colaboradorId: 1, followUps: 1 }))).toBe(1.5);
  });

  it("sums the three blocks", () => {
    expect(
      cargaPonderada(agente({ colaboradorId: 1, devolucoes: 2, ticketsEmRisco: 3, followUps: 2 })),
    ).toBe(2 + 6 + 3);
  });
});

describe("mediana", () => {
  it("is the middle value for an odd-length list", () => {
    expect(mediana([1, 5, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(mediana([1, 2, 3, 10])).toBe(2.5);
  });

  it("is zero for an empty list", () => {
    expect(mediana([])).toBe(0);
  });
});

describe("sugerirRedistribuicao — degenerate cases", () => {
  it("explains itself when the team is empty rather than returning nothing", () => {
    const s = sugerirRedistribuicao([]);
    expect(s.de).toBeNull();
    expect(s.para).toBeNull();
    expect(s.razao).toMatch(/não há agentes ativos/i);
  });

  it("does not suggest moving work when there is only one agent", () => {
    const s = sugerirRedistribuicao([agente({ colaboradorId: 1, devolucoes: 99 })]);
    expect(s.de).toBeNull();
    expect(s.razao).toContain("Agente 1");
    expect(s.razao).toMatch(/não há para quem redistribuir/i);
  });

  it("says so plainly when nobody has any work", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1 }),
      agente({ colaboradorId: 2 }),
      agente({ colaboradorId: 3 }),
    ]);
    expect(s.de).toBeNull();
    expect(s.razao).toMatch(/ninguém tem trabalho pendente/i);
  });

  it("suggests nothing when every agent carries an identical load", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 4 }),
      agente({ colaboradorId: 2, devolucoes: 4 }),
      agente({ colaboradorId: 3, devolucoes: 4 }),
    ]);
    expect(s.de).toBeNull();
    expect(s.razao).toMatch(/equilibrada/i);
  });
});

describe("sugerirRedistribuicao — the rule", () => {
  it("moves work when one agent is more than 1.5x the median", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 10 }),
      agente({ colaboradorId: 2, devolucoes: 4 }),
      agente({ colaboradorId: 3, devolucoes: 1 }),
    ]);
    expect(s.de?.colaboradorId).toBe(1);
    expect(s.para?.colaboradorId).toBe(3);
  });

  it("does not move work at exactly 1.5x — the threshold is strict", () => {
    // median 4, most loaded 6 = exactly 1.5x
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 6 }),
      agente({ colaboradorId: 2, devolucoes: 4 }),
      agente({ colaboradorId: 3, devolucoes: 4 }),
    ]);
    expect(s.de).toBeNull();
    expect(s.razao).toMatch(/equilibrada/i);
  });

  it("moves work just past the threshold", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 7 }),
      agente({ colaboradorId: 2, devolucoes: 4 }),
      agente({ colaboradorId: 3, devolucoes: 4 }),
    ]);
    expect(s.de?.colaboradorId).toBe(1);
  });

  it("handles a median of zero, where the ratio test cannot apply", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 8 }),
      agente({ colaboradorId: 2 }),
      agente({ colaboradorId: 3 }),
    ]);
    expect(s.de?.colaboradorId).toBe(1);
    expect(s.para).not.toBeNull();
    expect(s.razao).toMatch(/mediana da equipa é zero/i);
  });

  it("counts tickets more heavily than calls when picking who is overloaded", () => {
    // Agent 1: 5 calls = 5 points. Agent 2: 4 tickets = 8 points.
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 5 }),
      agente({ colaboradorId: 2, ticketsEmRisco: 4 }),
      agente({ colaboradorId: 3, devolucoes: 1 }),
    ]);
    expect(s.de?.colaboradorId).toBe(2);
  });

  it("names the agents and the actual counts in its reasoning", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, nome: "Vânia", devolucoes: 6, ticketsEmRisco: 3, followUps: 2 }),
      agente({ colaboradorId: 2, nome: "Tiago", devolucoes: 2 }),
      agente({ colaboradorId: 3, nome: "Ana", devolucoes: 1 }),
    ]);
    expect(s.razao).toContain("Vânia");
    expect(s.razao).toContain("Ana");
    expect(s.razao).toContain("6 por devolver");
    expect(s.razao).toContain("3 tickets em risco");
    expect(s.razao).toContain("2 follow-ups");
  });

  it("is deterministic — equal loads break ties by id, not by array order", () => {
    // Median must stay low enough for the rule to fire, so the two tied
    // heavy agents sit above a majority of idle ones. With [10,10,1,1,1] the
    // median is 1 and the threshold 1.5, so a suggestion is produced and the
    // tie at the top is actually exercised.
    const a = [
      agente({ colaboradorId: 3, devolucoes: 10 }),
      agente({ colaboradorId: 1, devolucoes: 10 }),
      agente({ colaboradorId: 2, devolucoes: 1 }),
      agente({ colaboradorId: 4, devolucoes: 1 }),
      agente({ colaboradorId: 5, devolucoes: 1 }),
    ];
    const baralhado = [a[1], a[4], a[0], a[3], a[2]];

    const r = sugerirRedistribuicao(a);
    expect(r.de).not.toBeNull();
    expect(r.de?.colaboradorId).toBe(1); // lowest id wins the tie, not array order
    expect(r).toEqual(sugerirRedistribuicao(baralhado));
  });

  it("never suggests moving work from an agent to themselves", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, devolucoes: 10 }),
      agente({ colaboradorId: 2, devolucoes: 10 }),
    ]);
    if (s.de && s.para) expect(s.de.colaboradorId).not.toBe(s.para.colaboradorId);
  });

  it("writes the threshold with a decimal comma, like every other number", () => {
    const s = sugerirRedistribuicao([
      agente({ colaboradorId: 1, nome: "Vânia", devolucoes: 20 }),
      agente({ colaboradorId: 2, nome: "Tiago", devolucoes: 2 }),
      agente({ colaboradorId: 3, nome: "Ana", devolucoes: 1 }),
    ]);
    expect(s.razao).toContain("1,5×");
    expect(s.razao).not.toContain("1.5");
  });

  it("exposes its constants so the UI can explain the same rule", () => {
    expect(LIMIAR_SOBRECARGA).toBe(1.5);
    expect(PESOS).toEqual({ devolucoes: 1, ticketsEmRisco: 2, followUps: 1.5 });
  });
});
