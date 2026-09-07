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

/**
 * An instant at a given Lisbon wall-clock time on a given Lisbon calendar day.
 *
 * Deadlines are said in wall-clock terms — "até às 18:00", "até quinta-feira"
 * — and storing them as UTC arithmetic on a day boundary drifts by an hour
 * twice a year. Going through the zone's real offset for that date keeps
 * "18:00" meaning 18:00 in Lisbon in March and in August alike.
 */
export function lisbonInstant(yyyymmdd: string, hour: number, minute = 0): Date {
  const hh = String(Math.max(0, Math.min(23, Math.trunc(hour)))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, Math.trunc(minute)))).padStart(2, "0");
  return new Date(`${yyyymmdd}T${hh}:${mm}:00${lisbonOffsetForDate(yyyymmdd)}`);
}

/** Add calendar days to a `YYYY-MM-DD`, staying on the Lisbon calendar. */
export function somarDias(yyyymmdd: string, dias: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Day of week for a `YYYY-MM-DD`: 0 = Sunday … 6 = Saturday. */
export function diaDaSemana(yyyymmdd: string): number {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add working days, skipping Saturday and Sunday. `dias` must be >= 0. */
export function somarDiasUteis(yyyymmdd: string, dias: number): string {
  let dia = yyyymmdd;
  let restantes = Math.max(0, Math.trunc(dias));
  while (restantes > 0) {
    dia = somarDias(dia, 1);
    const w = diaDaSemana(dia);
    if (w !== 0 && w !== 6) restantes -= 1;
  }
  return dia;
}
