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
    // 2026-08-11 é uma terça: o dia anterior foi de trabalho.
    expect(planear(new Date("2026-08-11T07:00:00Z")).analise).toBe(-1);
    // A mesma expressão UTC no inverno seria 07:00 — e não deve disparar.
    expect(planear(new Date("2026-01-13T07:00:00Z")).analise).toBeNull();
  });

  it("dispara às 08:00 no inverno, que é outra hora UTC", () => {
    expect(planear(new Date("2026-01-13T08:00:00Z")).analise).toBe(-1);
  });

  it("dispara às 16:30, nas duas estações, e sobre o próprio dia", () => {
    expect(planear(new Date("2026-08-10T15:30:00Z")).analise).toBe(0);
    expect(planear(new Date("2026-01-12T16:30:00Z")).analise).toBe(0);
  });

  it("dispara uma vez por slot e não em cada tick da hora", () => {
    expect(planear(new Date("2026-08-11T07:00:00Z")).analise).toBe(-1);
    expect(planear(new Date("2026-08-11T07:15:00Z")).analise).toBeNull();
    expect(planear(new Date("2026-08-11T07:45:00Z")).analise).toBeNull();
  });

  it("nenhum slot cai entre dois ticks", () => {
    // A janela tem de ser pelo menos tão larga como o intervalo do cron, ou um
    // slot passa despercebido e a análise não corre nesse dia.
    for (const s of SLOTS_ANALISE) {
      expect(s.minuto % 15).toBe(0);
    }
  });
});

describe("planear — nenhum dia de trabalho fica por analisar", () => {
  /**
   * O erro que estes testes existem para apanhar: a corrida da manhã lê o dia
   * ANTERIOR, por isso correr de segunda a sexta perde a sexta-feira para
   * sempre. Sexta de manhã lê quinta; segunda de manhã lê domingo.
   */
  it("sábado de manhã analisa a sexta-feira", () => {
    // 2026-08-15 é um sábado.
    const sabado = planear(new Date("2026-08-15T07:00:00Z"));
    expect(sabado.analise).toBe(-1);
    // E não faz refresh: não está lá ninguém.
    expect(sabado.refresh).toBe(false);
  });

  it("todos os dias de trabalho são analisados alguma vez pela corrida da manhã", () => {
    // Uma semana inteira de ticks das 08:00, a ver que dias ficam cobertos.
    const cobertos = new Set<number>();
    for (let d = 10; d <= 16; d++) {
      // Agosto de 2026: 10 = segunda … 16 = domingo.
      const t = new Date(`2026-08-${d}T07:00:00Z`);
      const p = planear(t);
      if (p.analise === -1) cobertos.add(new Date(`2026-08-${d - 1}T12:00:00Z`).getUTCDay());
    }
    // Segunda (1) a sexta (5), todos.
    expect([...cobertos].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("domingo não faz nada", () => {
    const domingo = planear(new Date("2026-08-16T07:00:00Z"));
    expect(domingo.analise).toBeNull();
    expect(domingo.refresh).toBe(false);
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

  it("cala-se ao fim-de-semana", () => {
    // 2026-08-08 é um sábado; 2026-08-09 um domingo. O refresh não corre em
    // nenhum dos dois — mas a análise de sábado corre, e tem o seu teste.
    expect(planear(new Date("2026-08-08T07:00:00Z")).refresh).toBe(false);
    expect(planear(new Date("2026-08-09T07:00:00Z")).refresh).toBe(false);
  });
});
