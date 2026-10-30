/**
 * Data layer for the leads dashboard. Builds a Zoho Desk client from env,
 * caches the fetched ticket window in memory for 15 min, and applies a 10s
 * timeout per Desk request. No DB — everything is live (cached) from Desk.
 */
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { CHANNELS, isLeadOf } from "./channels.js";
import { dayLisbon } from "./compute.js";
import { classifyTipo } from "./tipo.js";
import { loadTicketStates } from "../storage/repo.js";
import type { LeadRow } from "./types.js";

export const SEM_RESPONSAVEL = "Sem responsável";

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

// Agent names change rarely; one Desk call per hour is plenty.
const AGENTS_TTL_MS = 60 * 60 * 1000;
let agentsCache: { names: Map<string, string>; fetchedAtMs: number } | null = null;

async function agentNames(c: ZohoDeskClient): Promise<Map<string, string>> {
  if (agentsCache && Date.now() - agentsCache.fetchedAtMs < AGENTS_TTL_MS) return agentsCache.names;
  const agents = await c.listAgents();
  const names = new Map(agents.map((a) => [a.id, `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.id]));
  agentsCache = { names, fetchedAtMs: Date.now() };
  return names;
}

/** Desk ticket fields the search does not always declare in our schema. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

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
  // Each channel still paginates internally; 9 in flight is within Desk limits.
  const [perChannel, names] = await Promise.all([
    Promise.all(
      CHANNELS.map((ch) =>
        c.searchTicketsByChannel({
          channel: ch.deskValue,
          createdTimeFrom,
          createdTimeTo,
          departmentId,
          ...(ch.customField ? { customField: ch.customField } : {}),
        }),
      ),
    ),
    // A failed agents call must not take the whole dashboard down: names fall
    // back to the Supervisor Virtual's copy, then to the Desk id.
    agentNames(c).catch((err: unknown) => {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "leads.agents_failed");
      return new Map<string, string>();
    }),
  ]);

  const byId = new Map<string, LeadRow>();
  let fetched = 0;
  CHANNELS.forEach((def, i) => {
    for (const t of perChannel[i]) {
      fetched++;
      // Exclude tickets whose subject contains "APRIL" (case-insensitive) right
      // after the fetch, before any aggregation — applies to every channel.
      if ((t.subject || "").toUpperCase().includes("APRIL")) continue;
      if (!t.createdTime || byId.has(t.id)) continue;
      if (!isLeadOf(def, t.channel, t.subject)) continue;
      const assigneeId = str(t.assigneeId);
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
        tipo: classifyTipo(def, t.subject, t.productName),
        assigneeId,
        assigneeName: assigneeId ? (names.get(assigneeId) ?? assigneeId) : SEM_RESPONSAVEL,
        aberto: (t.statusType ?? "") !== "Closed",
      });
    }
  });

  // Open / closed and the owner come from the Supervisor Virtual's copy of the
  // Desk when it has the ticket (it is refreshed by the sync job and also sees
  // changes made after the ticket was created). The live Desk value is the
  // fallback. A DB failure degrades to the Desk values instead of failing.
  try {
    const states = await loadTicketStates([...byId.keys()]);
    for (const [id, row] of byId) {
      const st = states.get(id);
      if (!st) continue;
      if (st.statusType) row.aberto = st.statusType !== "Closed" && st.statusType !== "Deleted";
      if (!row.assigneeId && st.assigneeId) {
        row.assigneeId = st.assigneeId;
        row.assigneeName = st.assigneeName || names.get(st.assigneeId) || st.assigneeId;
      } else if (row.assigneeId && row.assigneeName === row.assigneeId && st.assigneeName) {
        row.assigneeName = st.assigneeName;
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "leads.db_states_failed");
  }

  const rows = [...byId.values()];
  cache.set(key, { rows, fetchedAtMs: Date.now() });
  logger.info({ from, to, fetched, leads: rows.length }, "leads.fetch");
  return rows;
}
