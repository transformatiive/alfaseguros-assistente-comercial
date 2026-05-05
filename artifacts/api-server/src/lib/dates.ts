/**
 * Lisbon-aware date helpers. Avoids a heavy tz dependency by using built-in
 * Intl with `Europe/Lisbon`. DST is handled because Intl reads tzdata.
 */

const LISBON_TZ = "Europe/Lisbon";

/** Extract `YYYY-MM-DD` from an instant interpreted in Europe/Lisbon. */
export function toLisbonDate(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: LISBON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(instant);
}

/** Today (Lisbon) as `YYYY-MM-DD`. */
export function todayLisbon(now: Date = new Date()): string {
  return toLisbonDate(now);
}

/** `YYYY-MM-DD` for `n` days ago (Lisbon time). `n` MUST be a non-negative integer. */
export function lisbonDateOffset(offsetDays: number, now: Date = new Date()): string {
  if (!Number.isFinite(offsetDays)) return todayLisbon(now);
  const today = todayLisbon(now);
  const [y, m, d] = today.split("-").map(Number);
  // Construct a UTC midnight for the Lisbon date, shift, then re-extract Lisbon date.
  const utc = Date.UTC(y, m - 1, d) + offsetDays * 86_400_000;
  return toLisbonDate(new Date(utc));
}

function lisbonOffsetForDate(yyyymmdd: string): string {
  // Build a noon-Lisbon instant to side-step DST-edge ambiguity, then ask Intl
  // for its long offset notation ("GMT+01:00", "GMT+00:00").
  const probe = new Date(`${yyyymmdd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LISBON_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return "+00:00";
  return `${match[1]}${match[2]}:${match[3]}`;
}

/**
 * Lisbon day boundaries as ISO 8601 strings. Returned as `[start, end]`
 * suitable for Ringover's `start_date` / `end_date` query params.
 */
export function lisbonDayBoundsISO(yyyymmdd: string): [string, string] {
  const offset = lisbonOffsetForDate(yyyymmdd);
  return [`${yyyymmdd}T00:00:00${offset}`, `${yyyymmdd}T23:59:59${offset}`];
}

/** Validate a string looks like `YYYY-MM-DD`. */
export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}
