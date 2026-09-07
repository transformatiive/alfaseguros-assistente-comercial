import { describe, expect, it } from "vitest";
import { HORA_FIM, HORA_INICIO, planear, relogioLisboa, SLOTS_ANALISE } from "./agenda-plano.js";

/**
 * The point of these tests is the hour, not the arithmetic.
 *
 * Railway fires this in UTC and Portugal is UTC+1 for seven months and UTC+0
 * for five. Every pair below is the *same wall-clock moment in Lisbon* written
 * with the two different offsets — which is the bug this rule exists to avoid.
 */
describe("relogioLisboa", () => {
  it("lê a hora de Lisboa e não a do servidor", () => {
    // Verão (WEST, UTC+1): 07:00 Z são 08:00 em Lisboa.
    expect(relogioLisboa(new Date("2026-08-10T07:00:00Z"))).toEqual({
      dia: 1,
      hora: 8,
      minuto: 0,
    });
    // Inverno (WET, UTC+0): 07:00 Z são 07:00 em Lisboa.
    expect(relogioLisboa(new Date("2026-01-12T07:00:00Z"))).toEqual({
      dia: 1,
      hora: 7,
      minuto: 0,
    });
  });
});

describe("planear — a análise cai às 08:00 de Lisboa o ano inteiro", () => {
  it("dispara às 08:00 no verão", () => {
    expect(planear(new Date("2026-08-10T07:00:00Z")).analise).toBe(true);
    // A mesma expressão UTC no inverno seria 07:00 — e não deve disparar.
    expect(planear(new Date("2026-01-12T07:00:00Z")).analise).toBe(false);
  });

  it("dispara às 08:00 no inverno, que é outra hora UTC", () => {
    expect(planear(new Date("2026-01-12T08:00:00Z")).analise).toBe(true);
  });

  it("dispara às 16:30, nas duas estações", () => {
    expect(planear(new Date("2026-08-10T15:30:00Z")).analise).toBe(true);
    expect(planear(new Date("2026-01-12T16:30:00Z")).analise).toBe(true);
  });

  it("dispara uma vez por slot e não em cada tick da hora", () => {
    // 08:00 dispara; 08:15, 08:30 e 08:45 já não.
    expect(planear(new Date("2026-08-10T07:00:00Z")).analise).toBe(true);
    expect(planear(new Date("2026-08-10T07:15:00Z")).analise).toBe(false);
    expect(planear(new Date("2026-08-10T07:45:00Z")).analise).toBe(false);
  });

  it("nenhum slot cai entre dois ticks", () => {
    // A janela tem de ser pelo menos tão larga como o intervalo do cron, ou um
    // slot passa despercebido e a análise não corre nesse dia.
    for (const s of SLOTS_ANALISE) {
      expect(s.minuto % 15).toBe(0);
    }
  });
});

describe("planear — o refresh", () => {
  it("corre de quarto em quarto de hora dentro do horário de trabalho", () => {
    expect(planear(new Date("2026-08-10T08:45:00Z")).refresh).toBe(true);
    expect(planear(new Date("2026-08-10T17:15:00Z")).refresh).toBe(true);
  });

  it("cala-se de madrugada", () => {
    expect(planear(new Date("2026-08-10T02:00:00Z")).refresh).toBe(false);
    // 20:00 em Lisboa é o fim: já fora.
    expect(planear(new Date("2026-08-10T19:00:00Z")).refresh).toBe(false);
    expect(HORA_INICIO).toBeLessThan(HORA_FIM);
  });

  it("cala-se ao fim-de-semana, incluindo a análise", () => {
    // 2026-08-08 é um sábado; 2026-08-09 um domingo.
    const sabado = planear(new Date("2026-08-08T07:00:00Z"));
    expect(sabado.refresh).toBe(false);
    expect(sabado.analise).toBe(false);
    expect(planear(new Date("2026-08-09T07:00:00Z")).refresh).toBe(false);
  });
});
