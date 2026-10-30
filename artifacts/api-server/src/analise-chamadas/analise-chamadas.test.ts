import { describe, expect, it } from "vitest";
import type { RingoverCall } from "@workspace/ringover";
import { horaLisboa, normalizarChamada } from "./normalizar.js";
import {
  agregarVisaoGeral,
  resolverEquipa,
  totais,
  type ChamadaParaAgregar,
  type EquipaColaborador,
} from "./agregar.js";
import { lerPeriodo } from "../routes/analise-chamadas.js";

const ALFA = "351215832338";

function call(o: Partial<RingoverCall> = {}): RingoverCall {
  return {
    cdr_id: 1,
    direction: "in",
    is_answered: true,
    start_time: "2026-10-28T10:15:00Z",
    answered_time: "2026-10-28T10:15:20Z",
    incall_duration: 180,
    from_number: "351911234567",
    to_number: ALFA,
    user: { user_id: 23515187, firstname: "Beatriz", lastname: "Assunção" },
    ...o,
  };
}

describe("normalizarChamada", () => {
  it("keeps an answered inbound call with wait, talk time, Lisbon day and hour", () => {
    const r = normalizarChamada(call());
    expect(r).toMatchObject({
      cdrId: "1",
      dia: "2026-10-28",
      hora: 10, // 28 Oct is after DST ends: Lisbon = UTC
      direcao: "in",
      atendida: true,
      duracaoS: 180,
      esperaS: 20,
      agenteId: "23515187",
      agenteNome: "Beatriz Assunção",
      clienteNumero: "351911234567",
    });
  });

  it("uses the Lisbon calendar day across midnight in summer time", () => {
    const r = normalizarChamada(call({ start_time: "2026-07-01T23:30:00Z", answered_time: null }));
    expect(r?.dia).toBe("2026-07-02");
    expect(r?.hora).toBe(0);
  });

  it("missed call: no talk time, no wait", () => {
    const r = normalizarChamada(call({ is_answered: false, answered_time: null, last_state: "MISSED" }));
    expect(r).toMatchObject({ atendida: false, duracaoS: null, esperaS: null, estado: "MISSED" });
  });

  it("outbound: no wait, customer is the called number", () => {
    const r = normalizarChamada(call({ direction: "out", from_number: ALFA, to_number: "351922222222" }));
    expect(r).toMatchObject({ direcao: "out", esperaS: null, clienteNumero: "351922222222" });
  });

  it("falls back to queue_duration when answered_time is missing", () => {
    const r = normalizarChamada(call({ answered_time: null, queue_duration: 42 }));
    expect(r?.esperaS).toBe(42);
  });

  it("drops calls with no start or unknown direction", () => {
    expect(normalizarChamada(call({ start_time: null }))).toBeNull();
    expect(normalizarChamada(call({ start_time: "nonsense" }))).toBeNull();
    expect(normalizarChamada(call({ direction: "internal" }))).toBeNull();
  });

  it("rejects absurd durations instead of skewing averages", () => {
    const r = normalizarChamada(call({ incall_duration: -5, duration: 999999 }));
    expect(r?.duracaoS).toBeNull();
  });

  it("call with no user has no agent", () => {
    const r = normalizarChamada(call({ user: null, user_id: null }));
    expect(r?.agenteId).toBeNull();
    expect(r?.agenteNome).toBeNull();
  });

  it("horaLisboa respects summer time", () => {
    expect(horaLisboa(new Date("2026-07-01T08:00:00Z"))).toBe(9);
    expect(horaLisboa(new Date("2026-12-01T08:00:00Z"))).toBe(8);
  });
});

describe("resolverEquipa", () => {
  const roster = new Map<string, EquipaColaborador>([
    ["1", "vida"],
    ["2", "360"],
    ["3", "sinistros"],
    ["4", "admin"],
    ["5", "mkt"],
  ]);
  it("follows the roster; Sinistros counts as 360; admin/mkt as Corporate", () => {
    expect(resolverEquipa("1", null, roster)).toBe("vida");
    expect(resolverEquipa("2", null, roster)).toBe("360");
    expect(resolverEquipa("3", null, roster)).toBe("360");
    expect(resolverEquipa("4", null, roster)).toBe("corporate");
    expect(resolverEquipa("5", null, roster)).toBe("corporate");
  });
  it("360 names not yet in the roster still count as 360", () => {
    expect(resolverEquipa("99", "Tiago Paiva", roster)).toBe("360");
    expect(resolverEquipa("99", "JOÃO CATALÃO", roster)).toBe("360");
  });
  it("anyone else with a user is Corporate; no user is no team", () => {
    expect(resolverEquipa("99", "Alguém Novo", roster)).toBe("corporate");
    expect(resolverEquipa(null, "Tiago Paiva", roster)).toBe("sem_agente");
  });
});

function c(o: Partial<ChamadaParaAgregar> = {}): ChamadaParaAgregar {
  return {
    dia: "2026-10-27",
    hora: 10,
    direcao: "in",
    atendida: true,
    estado: null,
    duracaoS: 100,
    esperaS: 10,
    agenteId: "1",
    agenteNome: "Ana",
    clienteNumero: "351911111111",
    equipa: "360",
    ...o,
  };
}

describe("totais", () => {
  it("empty input gives zeros and nulls, never NaN", () => {
    expect(totais([])).toEqual({
      recebidas: 0,
      recebidasAtendidas: 0,
      feitas: 0,
      feitasAtendidas: 0,
      atendidasPct: null,
      esperaMediaS: null,
      duracaoMediaS: null,
    });
  });
  it("answer rate counts only inbound; wait averages answered inbound", () => {
    const t = totais([
      c({ esperaS: 10 }),
      c({ esperaS: 30 }),
      c({ atendida: false, esperaS: null, duracaoS: null }),
      c({ direcao: "out", esperaS: null, duracaoS: 60 }),
    ]);
    expect(t.recebidas).toBe(3);
    expect(t.feitas).toBe(1);
    expect(t.atendidasPct).toBe(66.7);
    expect(t.esperaMediaS).toBe(20);
    expect(t.duracaoMediaS).toBe(87); // (100+100+60)/3
  });
});

describe("agregarVisaoGeral", () => {
  const dados: ChamadaParaAgregar[] = [
    c({ equipa: "360", clienteNumero: "A" }),
    c({ equipa: "360", clienteNumero: "A", atendida: false, estado: "VOICEMAIL", duracaoS: null, esperaS: null }),
    c({ equipa: "360", clienteNumero: "A", atendida: false, estado: "MISSED", duracaoS: null, esperaS: null, hora: 13 }),
    c({ equipa: "vida", agenteId: "2", agenteNome: "Bea", direcao: "out", duracaoS: 45, esperaS: null, clienteNumero: "B" }),
    c({ equipa: "vida", agenteId: "2", agenteNome: "Bea", direcao: "out", duracaoS: 10, esperaS: null, clienteNumero: "C" }),
    c({ equipa: "corporate", agenteId: "3", agenteNome: "Rui", clienteNumero: "D", dia: "2026-10-28" }),
    c({ equipa: "sem_agente", agenteId: null, agenteNome: null, atendida: false, duracaoS: null, esperaS: null, clienteNumero: "E" }),
  ];

  it("all teams: KPIs, insistent customers, real conversations", () => {
    const v = agregarVisaoGeral(dados, "2026-10-26", "2026-10-30", "todas");
    expect(v.kpis.recebidas).toBe(5);
    expect(v.kpis.feitas).toBe(2);
    expect(v.kpis.atendidasPct).toBe(40);
    expect(v.kpis.clientes).toBe(3); // A, D, E
    expect(v.kpis.clientesInsistentesPct).toBe(33.3); // A called 3 times
    expect(v.kpis.conversasReaisPct).toBe(50); // 45 s yes, 10 s no
  });

  it("team filter keeps only that team; table still compares every team", () => {
    const v = agregarVisaoGeral(dados, "2026-10-26", "2026-10-30", "360");
    expect(v.kpis.recebidas).toBe(3);
    expect(v.kpis.feitas).toBe(0);
    expect(v.porEquipa.map((e) => e.id)).toEqual(["360", "vida", "corporate", "sem_agente"]);
    expect(v.porColaborador.map((p) => p.nome)).toEqual(["Ana"]);
  });

  it("splits what happens to inbound calls and the parts add up", () => {
    const v = agregarVisaoGeral(dados, "2026-10-26", "2026-10-30", "todas");
    const r = Object.fromEntries(v.resultadosRecebidas.map((x) => [x.id, x.total]));
    expect(r).toEqual({ atendidas: 2, caixa_voz: 1, nao_atendidas: 2 });
    expect(r.atendidas + r.caixa_voz + r.nao_atendidas).toBe(v.kpis.recebidas);
  });

  it("days: every weekday of the period, zero-filled; weekend only with calls", () => {
    const v = agregarVisaoGeral(
      [...dados, c({ dia: "2026-10-31" })],
      "2026-10-26",
      "2026-11-01",
      "todas",
    );
    expect(v.porDia.map((d) => d.dia)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(v.porDia[0]).toEqual({ dia: "2026-10-26", recebidas: 0, feitas: 0, recebidasAtendidas: 0 });
    const soma = v.porDia.reduce((a, d) => a + d.recebidas + d.feitas, 0);
    expect(soma).toBe(dados.length + 1);
  });

  it("hours: 8h to 19h at least, answer % per hour", () => {
    const v = agregarVisaoGeral(dados, "2026-10-26", "2026-10-30", "todas");
    expect(v.porHora[0].hora).toBe(8);
    expect(v.porHora[v.porHora.length - 1].hora).toBe(19);
    expect(v.porHora.find((h) => h.hora === 13)).toMatchObject({ recebidas: 1, atendidas: 0, pct: 0 });
    expect(v.porHora.find((h) => h.hora === 9)).toMatchObject({ recebidas: 0, pct: null });
  });

  it("no calls at all: valid empty structure", () => {
    const v = agregarVisaoGeral([], "2026-10-26", "2026-10-26", "todas");
    expect(v.kpis.atendidasPct).toBeNull();
    expect(v.porDia).toHaveLength(1);
    expect(v.porEquipa.map((e) => e.id)).toEqual(["360", "vida", "corporate"]);
    expect(v.porColaborador).toEqual([]);
  });
});

describe("lerPeriodo", () => {
  it("accepts a valid period and defaults to all teams", () => {
    expect(lerPeriodo({ de: "2026-10-01", ate: "2026-10-30" })).toEqual({
      ok: true,
      de: "2026-10-01",
      ate: "2026-10-30",
      equipa: "todas",
    });
  });
  it("rejects bad dates, inverted ranges, over a year, unknown team", () => {
    expect(lerPeriodo({ de: "2026-13-01", ate: "2026-10-30" }).ok).toBe(false);
    expect(lerPeriodo({ de: "2026-10-30", ate: "2026-10-01" }).ok).toBe(false);
    expect(lerPeriodo({ de: "2024-01-01", ate: "2026-10-30" }).ok).toBe(false);
    expect(lerPeriodo({ de: "2026-10-01", ate: "2026-10-30", equipa: "x" }).ok).toBe(false);
    expect(lerPeriodo({}).ok).toBe(false);
  });
});
