import { describe, it, expect } from "vitest";
import { computeDevolucoes } from "./devolucoes.js";
import type { RingoverCall } from "@workspace/ringover";

const ALFA = "351215832338";
const CLIENTE = "351911111111";

function call(over: Partial<RingoverCall> & { cdr_id: string | number }): RingoverCall {
  return {
    direction: "in",
    is_answered: false,
    start_time: "2026-08-28T09:00:00Z",
    from_number: CLIENTE,
    to_number: ALFA,
    ...over,
  } as RingoverCall;
}

const DIA = "2026-08-28";

describe("computeDevolucoes", () => {
  it("keeps an unanswered inbound call as pendente", () => {
    const out = computeDevolucoes([call({ cdr_id: 1 })], DIA);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ringoverCallId: "1",
      estado: "pendente",
      numeroNormalizado: "911111111",
      data: DIA,
      origem: null,
    });
  });

  it("ignores answered inbound calls and every outbound call", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, is_answered: true }),
        call({ cdr_id: 2, direction: "out", from_number: ALFA, to_number: CLIENTE }),
      ],
      DIA,
    );
    expect(out).toHaveLength(0);
  });

  it("auto-resolves when an answered outbound call to the same number follows", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, start_time: "2026-08-28T09:00:00Z" }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: "+351 911 111 111",
          start_time: "2026-08-28T10:30:00Z",
          user_id: 23275673,
        }),
      ],
      DIA,
    );
    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("devolvida");
    expect(out[0].origem).toBe("auto");
    expect(out[0].resolvidaPor).toBe("auto");
    expect(out[0].resolvidaAt?.toISOString()).toBe("2026-08-28T10:30:00.000Z");
  });

  it("does not resolve on a call back that happened BEFORE the missed call", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, start_time: "2026-08-28T14:00:00Z" }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: CLIENTE,
          start_time: "2026-08-28T09:00:00Z",
        }),
      ],
      DIA,
    );
    expect(out[0].estado).toBe("pendente");
  });

  it("does not resolve on an unanswered call back", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1 }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: false,
          from_number: ALFA,
          to_number: CLIENTE,
          start_time: "2026-08-28T11:00:00Z",
        }),
      ],
      DIA,
    );
    expect(out[0].estado).toBe("pendente");
  });

  it("does not resolve on a call back to a different customer", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1 }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: "351922222222",
          start_time: "2026-08-28T11:00:00Z",
        }),
      ],
      DIA,
    );
    expect(out[0].estado).toBe("pendente");
  });

  it("settles every missed call from the same number with one call back", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, start_time: "2026-08-28T09:00:00Z" }),
        call({ cdr_id: 2, start_time: "2026-08-28T09:20:00Z" }),
        call({
          cdr_id: 3,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: CLIENTE,
          start_time: "2026-08-28T10:00:00Z",
        }),
      ],
      DIA,
    );
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.estado === "devolvida")).toBe(true);
  });

  it("attributes to the agent who called the customer back when the missed call has no user", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, user_id: null }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: CLIENTE,
          start_time: "2026-08-28T10:00:00Z",
          user_id: 23275677,
        }),
      ],
      DIA,
    );
    expect(out[0].ringoverUserId).toBe("23275677");
  });

  it("prefers the missed call's own user over the call-back agent", () => {
    const out = computeDevolucoes(
      [
        call({ cdr_id: 1, user_id: 23275673 }),
        call({
          cdr_id: 2,
          direction: "out",
          is_answered: true,
          from_number: ALFA,
          to_number: CLIENTE,
          start_time: "2026-08-28T10:00:00Z",
          user_id: 23275677,
        }),
      ],
      DIA,
    );
    expect(out[0].ringoverUserId).toBe("23275673");
  });

  it("leaves an unattributable missed call for the shared bucket", () => {
    const out = computeDevolucoes([call({ cdr_id: 1, user_id: null })], DIA);
    expect(out[0].ringoverUserId).toBeNull();
  });

  it("skips a call with no usable customer number", () => {
    const out = computeDevolucoes(
      [call({ cdr_id: 1, from_number: "123", to_number: ALFA, contact_number: null })],
      DIA,
    );
    expect(out).toHaveLength(0);
  });

  it("skips a call with no start_time", () => {
    const out = computeDevolucoes([call({ cdr_id: 1, start_time: null })], DIA);
    expect(out).toHaveLength(0);
  });

  it("de-duplicates a cdr_id repeated across pages", () => {
    const out = computeDevolucoes([call({ cdr_id: 1 }), call({ cdr_id: 1 })], DIA);
    expect(out).toHaveLength(1);
  });

  it("is deterministic — the same input yields the same output, oldest first", () => {
    const calls = [
      call({ cdr_id: 2, start_time: "2026-08-28T11:00:00Z" }),
      call({ cdr_id: 1, start_time: "2026-08-28T09:00:00Z" }),
    ];
    const a = computeDevolucoes(calls, DIA);
    const b = computeDevolucoes(calls, DIA);
    expect(a.map((d) => d.ringoverCallId)).toEqual(["1", "2"]);
    expect(a).toEqual(b);
  });
});
