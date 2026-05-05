import { describe, expect, it } from "vitest";
import { digitsOnly, phoneFingerprint, phonesMatch } from "./index.js";

describe("digitsOnly", () => {
  it("strips spaces, +, and dashes", () => {
    expect(digitsOnly("+351 911 234 567")).toBe("351911234567");
    expect(digitsOnly("00351-911-234-567")).toBe("00351911234567");
    expect(digitsOnly("911234567")).toBe("911234567");
  });
  it("returns '' for null/undefined", () => {
    expect(digitsOnly(null)).toBe("");
    expect(digitsOnly(undefined)).toBe("");
  });
});

describe("phoneFingerprint", () => {
  it("returns the last 9 digits across PT formats", () => {
    expect(phoneFingerprint("+351 911 234 567")).toBe("911234567");
    expect(phoneFingerprint("351911234567")).toBe("911234567");
    expect(phoneFingerprint("00351911234567")).toBe("911234567");
    expect(phoneFingerprint("911234567")).toBe("911234567");
  });
  it("returns '' when fewer than 9 digits", () => {
    expect(phoneFingerprint("12345")).toBe("");
    expect(phoneFingerprint("")).toBe("");
    expect(phoneFingerprint(null)).toBe("");
  });
});

describe("phonesMatch", () => {
  it("matches Ringover digits and Desk free-form for the same line", () => {
    expect(phonesMatch("351911234567", "+351 911 234 567")).toBe(true);
    expect(phonesMatch("00351 911234567", "351911234567")).toBe(true);
  });
  it("does not match different lines", () => {
    expect(phonesMatch("351911234567", "351911234568")).toBe(false);
  });
  it("returns false on missing input", () => {
    expect(phonesMatch(null, "351911234567")).toBe(false);
    expect(phonesMatch("351911234567", undefined)).toBe(false);
  });
});
