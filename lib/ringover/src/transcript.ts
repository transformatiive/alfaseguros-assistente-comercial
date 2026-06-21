import type { RingoverTranscription } from "./types.js";

export interface ConcatenateOptions {
  /** Hard cap on the output length to protect the LLM token budget. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 12_000;

function speakerLabel(channelId: number | null | undefined): string {
  if (channelId === 0) return "Locutor A";
  if (channelId === 1) return "Locutor B";
  return "Locutor ?";
}

/**
 * Concatenate a Ringover transcription's speech segments into a readable,
 * speaker-labelled dialog — the real transcript, with NO AI synthesis. Segments
 * are ordered by start time; one speaker is the agent (inferred downstream from
 * the agent name in the prompt header). Returns "" when there is nothing usable,
 * so callers can fall back to the Ringover `note` summary.
 */
export function concatenateTranscript(
  transcription: RingoverTranscription | null | undefined,
  opts: ConcatenateOptions = {},
): string {
  const speeches = transcription?.transcription_data?.speeches ?? [];
  if (!speeches || speeches.length === 0) return "";

  const lines = [...speeches]
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .map((s) => ({ label: speakerLabel(s.channelId), text: (s.text ?? "").trim() }))
    .filter((l) => l.text.length > 0)
    .map((l) => `${l.label}: ${l.text}`);

  if (lines.length === 0) return "";

  let out = lines.join("\n");
  const cap = opts.maxChars ?? DEFAULT_MAX_CHARS;
  if (out.length > cap) {
    out = out.slice(0, cap).trimEnd() + "\n[...transcrição truncada...]";
  }
  return out;
}
