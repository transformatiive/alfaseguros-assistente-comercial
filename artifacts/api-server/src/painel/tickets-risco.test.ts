import { describe, it, expect } from "vitest";
import { idadeEmHoras, RISCO_THRESHOLD_HOURS } from "./tickets-risco.js";

describe("idadeEmHoras", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("rounds down — 23h59m is 23 hours, not 24", () => {
    expect(idadeEmHoras(new Date("2026-08-27T12:01:00Z"), now)).toBe(23);
  });

  it("counts a ticket opened exactly 24 hours ago as 24", () => {
    expect(idadeEmHoras(new Date("2026-08-27T12:00:00Z"), now)).toBe(24);
  });

  it("counts long-open tickets in whole hours", () => {
    expect(idadeEmHoras(new Date("2026-08-25T12:00:00Z"), now)).toBe(72);
  });

  it("is zero for a ticket opened this minute", () => {
    expect(idadeEmHoras(now, now)).toBe(0);
  });

  it("holds across a Lisbon DST change, because it works in absolute time", () => {
    // 2026-10-25 02:00 UTC is the autumn change in Europe/Lisbon. 24 absolute
    // hours is 24 hours whatever the wall clock did.
    const after = new Date("2026-10-25T12:00:00Z");
    expect(idadeEmHoras(new Date("2026-10-24T12:00:00Z"), after)).toBe(24);
  });
});

describe("RISCO_THRESHOLD_HOURS", () => {
  it("is the 24-hour SLA the follow-up payload also reports", () => {
    expect(RISCO_THRESHOLD_HOURS).toBe(24);
  });
});
