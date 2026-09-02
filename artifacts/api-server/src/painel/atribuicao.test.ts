import { describe, it, expect } from "vitest";
import {
  atribuirPorTicket,
  JANELA_TICKET_MS,
  type ChamadaParaAtribuir,
  type TicketParaAtribuicao,
} from "./atribuicao.js";

const T0 = new Date("2026-08-28T10:00:00Z");

function chamada(over: Partial<ChamadaParaAtribuir> = {}): ChamadaParaAtribuir {
  return {
    ringoverCallId: "c1",
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
