import { describe, it, expect } from "vitest";
import { concatenateTranscript } from "./transcript.js";
import type { RingoverTranscription } from "./types.js";

function tx(speeches: Array<{ channelId?: number; start?: number; text?: string }>): RingoverTranscription {
  return { transcription_data: { speeches } } as RingoverTranscription;
}

describe("concatenateTranscript", () => {
  it("returns '' for null / empty / no usable text", () => {
    expect(concatenateTranscript(null)).toBe("");
    expect(concatenateTranscript(tx([]))).toBe("");
    expect(concatenateTranscript(tx([{ channelId: 0, start: 0, text: "  " }]))).toBe("");
  });

  it("orders by start time and labels speakers by channel", () => {
    const out = concatenateTranscript(
      tx([
        { channelId: 1, start: 2.5, text: "Olá, sou a Ana." },
        { channelId: 0, start: 1.0, text: "Estou?" },
      ]),
    );
    expect(out).toBe("Locutor A: Estou?\nLocutor B: Olá, sou a Ana.");
  });

  it("drops empty segments but keeps the rest", () => {
    const out = concatenateTranscript(
      tx([
        { channelId: 0, start: 1, text: "Bom dia" },
        { channelId: 1, start: 2, text: "" },
        { channelId: 0, start: 3, text: "Como está?" },
      ]),
    );
    expect(out).toBe("Locutor A: Bom dia\nLocutor A: Como está?");
  });

  it("truncates beyond maxChars", () => {
    const long = "x".repeat(50);
    const out = concatenateTranscript(
      tx([{ channelId: 0, start: 1, text: long }]),
      { maxChars: 20 },
    );
    expect(out.length).toBeLessThan(long.length + 30);
    expect(out).toContain("truncada");
  });
});
