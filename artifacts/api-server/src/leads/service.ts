/**
 * Data layer for the leads dashboard. Builds a Zoho Desk client from env,
 * caches the fetched ticket window in memory for 15 min, and applies a 10s
 * timeout per Desk request. No DB — everything is live (cached) from Desk.
 */
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { matchChannel } from "./channels.js";
import { dayLisbon } from "./compute.js";
import type { LeadRow } from "./types.js";

const DATA_TTL_MS = 15 * 60 * 1000;
const DESK_TIMEOUT_MS = 10_000;

export class LeadsConfigError extends Error {}

/** 10s-timeout fetch wrapper shared by the auth + Desk client. */
const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...(init ?? {}), signal: AbortSignal.timeout(DESK_TIMEOUT_MS) });

let client: ZohoDeskClient | null = null;

function getClient(): ZohoDeskClient {
  if (client) return client;
  const cfg = env();
  const missing = (["ZOHO_DESK_CLIENT_ID", "ZOHO_DESK_CLIENT_SECRET", "ZOHO_DESK_REFRESH_TOKEN", "ZOHO_DESK_ORG_ID"] as const).filter(
    (k) => !cfg[k],
  );
  if (missing.length > 0) {
    throw new LeadsConfigError(`Zoho Desk não configurado. Variáveis em falta: ${missing.join(", ")}`);
  }
  const auth = new ZohoAuth({
    clientId: cfg.ZOHO_DESK_CLIENT_ID!,
    clientSecret: cfg.ZOHO_DESK_CLIENT_SECRET!,
    refreshToken: cfg.ZOHO_DESK_REFRESH_TOKEN!,
    fetch: timeoutFetch,
  });
  client = new ZohoDeskClient({ auth, orgId: cfg.ZOHO_DESK_ORG_ID!, fetch: timeoutFetch });
  return client;
}

interface CacheEntry {
  rows: LeadRow[];
  fetchedAtMs: number;
}
const cache = new Map<string, CacheEntry>();

/** Lead-only fields — keep the Desk payload small. */
const LEADS_FIELDS = ["id", "ticketNumber", "subject", "status", "statusType", "channel", "createdTime"];

/**
 * Fetch + filter leads created in [from, to] (inclusive YYYY-MM-DD, Lisbon).
 * The window is widened to whole UTC days so Lisbon-edge tickets aren't missed.
 * Cached in memory for 15 minutes per (from,to) key.
 */
export async function fetchLeads(from: string, to: string): Promise<LeadRow[]> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAtMs < DATA_TTL_MS) return hit.rows;

  const cfg = env();
  const c = getClient();
  const tickets = await c.listTicketsCreatedBetween({
    // Pad by a day on each side: Lisbon (UTC+0/+1) vs UTC day boundaries.
    createdTimeFrom: `${from}T00:00:00.000Z`,
    createdTimeTo: `${to}T23:59:59.999Z`,
    fields: LEADS_FIELDS,
    departmentId: cfg.ZOHO_DESK_NAOVIDA_DEPARTMENT_ID,
  });

  const rows: LeadRow[] = [];
  for (const t of tickets) {
    if (!t.createdTime) continue;
    const def = matchChannel(t.channel, t.subject);
    if (!def) continue;
    rows.push({
      id: t.id,
      ticketNumber: String(t.ticketNumber ?? ""),
      subject: (t.subject ?? "").trim(),
      status: (t.status ?? "—").trim(),
      channelKey: def.key,
      channelLabel: def.label,
      channelColor: def.color,
      createdTime: t.createdTime,
      day: dayLisbon(t.createdTime),
    });
  }

  cache.set(key, { rows, fetchedAtMs: Date.now() });
  logger.info({ from, to, tickets: tickets.length, leads: rows.length }, "leads.fetch");
  return rows;
}
