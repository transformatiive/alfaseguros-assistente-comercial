/**
 * Data layer for the leads dashboard. Builds a Zoho Desk client from env,
 * caches the fetched ticket window in memory for 15 min, and applies a 10s
 * timeout per Desk request. No DB — everything is live (cached) from Desk.
 */
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { CHANNELS, matchChannel } from "./channels.js";
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

/**
 * Fetch + filter leads created in [from, to] (inclusive YYYY-MM-DD, Lisbon).
 * Uses the Desk Search API per channel (server-side channel + date filtering),
 * so we never page the whole ticket stream (the dept has ~150 tickets/day,
 * mostly Email). Cached in memory for 15 minutes per (from,to) key.
 */
export async function fetchLeads(from: string, to: string): Promise<LeadRow[]> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAtMs < DATA_TTL_MS) return hit.rows;

  const cfg = env();
  const c = getClient();
  // Pad to whole UTC days so Lisbon-edge (UTC+0/+1) tickets aren't missed.
  const createdTimeFrom = `${from}T00:00:00.000Z`;
  const createdTimeTo = `${to}T23:59:59.999Z`;
  const departmentId = cfg.ZOHO_DESK_NAOVIDA_DEPARTMENT_ID;

  // Fetch all channels concurrently — the slowest channel sets the wall-clock,
  // instead of the sum of all of them (cold loads were ~6x slower sequentially).
  // Each channel still paginates internally; 6 in flight is well within Desk limits.
  const perChannel = await Promise.all(
    CHANNELS.map((ch) =>
      c.searchTicketsByChannel({ channel: ch.deskValue, createdTimeFrom, createdTimeTo, departmentId }),
    ),
  );

  const byId = new Map<string, LeadRow>();
  let fetched = 0;
  for (const tickets of perChannel) {
    fetched += tickets.length;
    for (const t of tickets) {
      if (!t.createdTime || byId.has(t.id)) continue;
      const def = matchChannel(t.channel, t.subject); // applies the SITE "SITE:" subject rule
      if (!def) continue;
      byId.set(t.id, {
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
  }

  const rows = [...byId.values()];
  cache.set(key, { rows, fetchedAtMs: Date.now() });
  logger.info({ from, to, fetched, leads: rows.length }, "leads.fetch");
  return rows;
}
