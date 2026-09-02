import { describe, it, expect } from "vitest";
import {
  atribuirPorHistorico,
  atribuirPorTicket,
  propagarNoGrupo,
  JANELA_TICKET_MS,
  type ChamadaParaAtribuir,
  type TicketParaAtribuicao,
} from "./atribuicao.js";

const T0 = new Date("2026-08-28T10:00:00Z");

function chamada(over: Partial<ChamadaParaAtribuir> = {}): ChamadaParaAtribuir {
  return {
    ringoverCallId: "c1",
    data: "2026-08-28",
    numeroNormalizado: "911051149",
    horaChamada: T0,
    ...over,
  };
}

function ticket(over: Partial<TicketParaAtribuicao> = {}): TicketParaAtribuicao {
  return {
    id: "t1",
    phoneFingerprint: "911051149",
    createdTime: new Date(T0.getTime() + 5_000),
    assigneeId: "367662000022555001",
    ...over,
  };
}

describe("atribuirPorTicket", () => {
  it("matches the ticket created seconds after the call", () => {
    const r = atribuirPorTicket([chamada()], [ticket()]);
    expect(r.get("c1")).toEqual({ ticketId: "t1", zid: "367662000022555001" });
  });

  it("ignores a ticket created BEFORE the call", () => {
    const r = atribuirPorTicket(
      [chamada()],
      [ticket({ createdTime: new Date(T0.getTime() - 60_000) })],
    );
    expect(r.size).toBe(0);
  });

  it("ignores a ticket beyond the window", () => {
    const r = atribuirPorTicket(
      [chamada()],
      [ticket({ createdTime: new Date(T0.getTime() + JANELA_TICKET_MS + 1) })],
    );
    expect(r.size).toBe(0);
  });

  it("accepts a ticket exactly at the window edge", () => {
    const r = atribuirPorTicket(
      [chamada()],
      [ticket({ createdTime: new Date(T0.getTime() + JANELA_TICKET_MS) })],
    );
    expect(r.get("c1")?.ticketId).toBe("t1");
  });

  it("ignores a ticket for a different number", () => {
    const r = atribuirPorTicket([chamada()], [ticket({ phoneFingerprint: "999999999" })]);
    expect(r.size).toBe(0);
  });

  it("normalises the ticket's phone before comparing", () => {
    // Desk stores free-form; the fingerprint is the last 9 digits either way.
    const r = atribuirPorTicket([chamada()], [ticket({ phoneFingerprint: "+351 911 051 149" })]);
    expect(r.get("c1")?.ticketId).toBe("t1");
  });

  it("gives each call its own ticket when a customer calls twice", () => {
    const r = atribuirPorTicket(
      [
        chamada({ ringoverCallId: "c1", horaChamada: T0 }),
        chamada({ ringoverCallId: "c2", horaChamada: new Date(T0.getTime() + 240_000) }),
      ],
      [
        ticket({ id: "t1", createdTime: new Date(T0.getTime() + 5_000) }),
        ticket({ id: "t2", createdTime: new Date(T0.getTime() + 245_000) }),
      ],
    );
    expect(r.get("c1")?.ticketId).toBe("t1");
    expect(r.get("c2")?.ticketId).toBe("t2");
  });

  it("never lets two calls claim the same ticket", () => {
    const r = atribuirPorTicket(
      [
        chamada({ ringoverCallId: "c1", horaChamada: T0 }),
        chamada({ ringoverCallId: "c2", horaChamada: new Date(T0.getTime() + 60_000) }),
      ],
      [ticket({ id: "t1", createdTime: new Date(T0.getTime() + 90_000) })],
    );
    // The earlier call claims it; the later one is left for the fallbacks.
    expect(r.get("c1")?.ticketId).toBe("t1");
    expect(r.has("c2")).toBe(false);
  });

  it("carries a null assignee through rather than dropping the link", () => {
    // An unassigned ticket still tells the panel a ticket exists — which the
    // load formula needs in order not to double-count it.
    const r = atribuirPorTicket([chamada()], [ticket({ assigneeId: null })]);
    expect(r.get("c1")).toEqual({ ticketId: "t1", zid: null });
  });

  it("skips tickets with no phone or no creation time", () => {
    const r = atribuirPorTicket(
      [chamada()],
      [ticket({ phoneFingerprint: null }), ticket({ id: "t2", createdTime: null })],
    );
    expect(r.size).toBe(0);
  });

  it("is independent of input order", () => {
    const cs = [
      chamada({ ringoverCallId: "c2", horaChamada: new Date(T0.getTime() + 240_000) }),
      chamada({ ringoverCallId: "c1", horaChamada: T0 }),
    ];
    const ts = [
      ticket({ id: "t2", createdTime: new Date(T0.getTime() + 245_000) }),
      ticket({ id: "t1", createdTime: new Date(T0.getTime() + 5_000) }),
    ];
    const r = atribuirPorTicket(cs, ts);
    expect(r.get("c1")?.ticketId).toBe("t1");
    expect(r.get("c2")?.ticketId).toBe("t2");
  });

  it("returns nothing when there are no tickets at all", () => {
    expect(atribuirPorTicket([chamada()], []).size).toBe(0);
  });
});

describe("propagarNoGrupo", () => {
  const t = ticket();

  it("dá o dono do ticket às reinsistências do mesmo número no mesmo dia", () => {
    const c1 = chamada({ ringoverCallId: "c1" });
    const c2 = chamada({ ringoverCallId: "c2", horaChamada: new Date(T0.getTime() + 600_000) });
    const c3 = chamada({ ringoverCallId: "c3", horaChamada: new Date(T0.getTime() + 900_000) });

    const atrib = atribuirPorTicket([c1, c2, c3], [t]);
    expect(atrib.size).toBe(1);

    const grupo = propagarNoGrupo([c1, c2, c3], atrib);
    expect([...grupo.keys()].sort()).toEqual(["c2", "c3"]);
    expect(grupo.get("c2")).toBe(t.assigneeId);
  });

  it("não propaga entre números diferentes", () => {
    const c1 = chamada({ ringoverCallId: "c1" });
    const outro = chamada({ ringoverCallId: "c9", numeroNormalizado: "966293662" });
    const grupo = propagarNoGrupo([c1, outro], atribuirPorTicket([c1, outro], [t]));
    expect(grupo.has("c9")).toBe(false);
  });

  it("não propaga entre dias diferentes", () => {
    const c1 = chamada({ ringoverCallId: "c1" });
    const ontem = chamada({ ringoverCallId: "c0", data: "2026-08-27" });
    const grupo = propagarNoGrupo([c1, ontem], atribuirPorTicket([c1], [t]));
    expect(grupo.has("c0")).toBe(false);
  });

  it("nunca sobrepõe uma atribuição já feita por ticket próprio", () => {
    const c1 = chamada({ ringoverCallId: "c1" });
    const grupo = propagarNoGrupo([c1], atribuirPorTicket([c1], [t]));
    expect(grupo.has("c1")).toBe(false);
  });
});

describe("atribuirPorHistorico", () => {
  it("usa o dono do último ticket do cliente", () => {
    const c = chamada({ ringoverCallId: "c1" });
    const out = atribuirPorHistorico([c], new Set(), new Map([["911051149", "zidX"]]));
    expect(out.get("c1")).toBe("zidX");
  });

  it("deixa em branco um cliente sem histórico nenhum", () => {
    const c = chamada({ ringoverCallId: "c1", numeroNormalizado: "999999999" });
    const out = atribuirPorHistorico([c], new Set(), new Map([["911051149", "zidX"]]));
    expect(out.size).toBe(0);
  });

  it("não mexe em chamadas já atribuídas por camadas mais fortes", () => {
    const c = chamada({ ringoverCallId: "c1" });
    const out = atribuirPorHistorico([c], new Set(["c1"]), new Map([["911051149", "zidX"]]));
    expect(out.size).toBe(0);
  });
});
