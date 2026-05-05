import { describe, expect, it } from "vitest";
import {
  isValidIsoDate,
  lisbonDateOffset,
  lisbonDayBoundsISO,
  todayLisbon,
} from "./dates.js";

describe("isValidIsoDate", () => {
  it("accepts well-formed YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-04-30")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isValidIsoDate("2026-4-30")).toBe(false);
    expect(isValidIsoDate("yesterday")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
  });
});

describe("lisbonDateOffset", () => {
  it("returns today when offset is 0", () => {
    const fakeNow = new Date("2026-04-30T12:00:00Z");
    expect(lisbonDateOffset(0, fakeNow)).toBe(todayLisbon(fakeNow));
  });
  it("returns yesterday for -1", () => {
    const fakeNow = new Date("2026-04-30T12:00:00Z");
    expect(lisbonDateOffset(-1, fakeNow)).toBe("2026-04-29");
  });
  it("returns previous day across the month boundary", () => {
    const fakeNow = new Date("2026-05-01T12:00:00Z");
    expect(lisbonDateOffset(-1, fakeNow)).toBe("2026-04-30");
  });
});

describe("lisbonDayBoundsISO", () => {
  it("uses the +01:00 offset during summer time", () => {
    const [start, end] = lisbonDayBoundsISO("2026-07-15");
    expect(start).toBe("2026-07-15T00:00:00+01:00");
    expect(end).toBe("2026-07-15T23:59:59+01:00");
  });

  it("uses the +00:00 offset during winter time", () => {
    const [start, end] = lisbonDayBoundsISO("2026-01-15");
    expect(start).toBe("2026-01-15T00:00:00+00:00");
    expect(end).toBe("2026-01-15T23:59:59+00:00");
  });
});
