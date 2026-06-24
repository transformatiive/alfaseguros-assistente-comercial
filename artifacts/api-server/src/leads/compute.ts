/**
 * Pure date + aggregation helpers for the leads dashboard. No I/O here — takes
 * already-fetched LeadRow[] and a Period and produces the view model.
 */
import { CHANNELS } from "./channels.js";
import type { LeadRow, Period } from "./types.js";

// --- date helpers (operate on YYYY-MM-DD strings, parsed at UTC noon to dodge DST) ---

export function todayLisbon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(now);
}

/** Lisbon calendar day (YYYY-MM-DD) of an ISO instant. */
export function dayLisbon(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date(iso));
}

function parse(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
/** Inclusive day count between two YYYY-MM-DD. */
export function dayCount(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}
/** Monday of the week containing `s`. */
export function weekStart(s: string): string {
  const d = parse(s);
  const offset = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(s, -offset);
}
export function formatDDMM(s: string): string {
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve the requested period from preset + explicit from/to query params. */
export function resolvePeriod(query: { preset?: string; from?: string; to?: string }, today = todayLisbon()): Period {
  let from: string;
  let to = today;
  let preset = query.preset ?? "30d";

  const validFrom = query.from && DATE_RE.test(query.from) ? query.from : null;
  const validTo = query.to && DATE_RE.test(query.to) ? query.to : null;

  if (validFrom && validTo) {
    from = validFrom <= validTo ? validFrom : validTo;
    to = validFrom <= validTo ? validTo : validFrom;
    preset = "custom";
  } else {
    switch (preset) {
      case "hoje": from = today; break;
      case "7d": from = addDays(today, -6); break;
      case "90d": from = addDays(today, -89); break;
      case "30d": default: from = addDays(today, -29); preset = "30d"; break;
    }
  }

  const days = dayCount(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from, to, days, prevFrom, prevTo, preset };
}

function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

export interface ChannelBreakdown {
  key: string;
  label: string;
  color: string;
  ontem: number;
  d7: number;
  d30: number;
  total: number;
  prevTotal: number;
  delta: number;
}

export interface WeekBar {
  start: string;
  label: string;
  count: number;
  isLatestComplete: boolean;
}

export interface LeadsView {
  period: Period;
  total: number;
  prevTotal: number;
  mediaDiaria: number;
  variacaoPct: number | null;
  canalMaisActivo: { label: string; volume: number } | null;
  breakdown: ChannelBreakdown[];
  weeks: WeekBar[];
  pageRows: LeadRow[];
  page: number;
  totalPages: number;
  totalInPeriod: number;
}

const PAGE_SIZE = 50;

export function buildView(rows: LeadRow[], period: Period, today: string, page: number): LeadsView {
  const yesterday = addDays(today, -1);
  const d7From = addDays(today, -6);
  const d30From = addDays(today, -29);

  const inPeriod = rows.filter((r) => inRange(r.day, period.from, period.to));
  const inPrev = rows.filter((r) => inRange(r.day, period.prevFrom, period.prevTo));

  // Per-channel breakdown.
  const breakdown: ChannelBreakdown[] = CHANNELS.map((c) => {
    const mine = rows.filter((r) => r.channelKey === c.key);
    const total = mine.filter((r) => inRange(r.day, period.from, period.to)).length;
    const prevTotal = mine.filter((r) => inRange(r.day, period.prevFrom, period.prevTo)).length;
    return {
      key: c.key,
      label: c.label,
      color: c.color,
      ontem: mine.filter((r) => r.day === yesterday).length,
      d7: mine.filter((r) => r.day >= d7From && r.day <= today).length,
      d30: mine.filter((r) => r.day >= d30From && r.day <= today).length,
      total,
      prevTotal,
      delta: total - prevTotal,
    };
  }).sort((a, b) => b.total - a.total);

  const total = inPeriod.length;
  const prevTotal = inPrev.length;
  const mediaDiaria = period.days > 0 ? Math.round((total / period.days) * 10) / 10 : 0;
  const variacaoPct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  const topChannel = breakdown[0] && breakdown[0].total > 0 ? { label: breakdown[0].label, volume: breakdown[0].total } : null;

  // Weekly buckets across the period (Monday-starting).
  const weekMap = new Map<string, number>();
  for (const r of inPeriod) {
    const ws = weekStart(r.day);
    weekMap.set(ws, (weekMap.get(ws) ?? 0) + 1);
  }
  // Ensure every week in range appears, even empty ones.
  let cursor = weekStart(period.from);
  const lastWeek = weekStart(period.to);
  const weekStarts: string[] = [];
  while (cursor <= lastWeek) {
    weekStarts.push(cursor);
    cursor = addDays(cursor, 7);
  }
  const thisWeekStart = weekStart(today);
  const weeks: WeekBar[] = weekStarts.map((ws) => ({
    start: ws,
    label: formatDDMM(ws),
    count: weekMap.get(ws) ?? 0,
    // Latest complete week = most recent week fully in the past (not the current week).
    isLatestComplete: false,
  }));
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].start < thisWeekStart) { weeks[i].isLatestComplete = true; break; }
  }

  // Individual leads table — newest first, paginated.
  const sorted = [...inPeriod].sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return {
    period,
    total,
    prevTotal,
    mediaDiaria,
    variacaoPct,
    canalMaisActivo: topChannel,
    breakdown,
    weeks,
    pageRows,
    page: safePage,
    totalPages,
    totalInPeriod: sorted.length,
  };
}
