/**
 * Zoho CRM leads for the channels the CRM owns (Nuno, 05/11/2026): the website
 * simulator ("ASISA / Simulador") and Caravela. Their leads land in the CRM
 * every day, while the Desk tickets for them stopped on 17/08/2026, so the
 * dashboard and the daily email count these two channels from the CRM.
 *
 *  - ASISA / Simulador = CRM leads with "Origem" (Lead_Source) "Form Simulador".
 *  - Caravela          = CRM leads that name Caravela (source, product, company
 *                        or description). Checked first, so it wins.
 */
import { z } from "zod";
import { ZohoAuth } from "@workspace/zoho-desk";
import { env } from "../lib/env.js";
import { CHANNEL_BY_KEY, norm, type ChannelDef } from "./channels.js";
import { addDays, dayLisbon } from "./compute.js";
import { classifyTipo } from "./tipo.js";
import type { LeadRow } from "./types.js";

/** Channel keys whose leads come from the CRM, not from Desk tickets. */
export const CRM_CHANNEL_KEYS: ReadonlySet<string> = new Set(["LEAD_ASISA", "LEAD_CARAVELA"]);

const CRM_TIMEOUT_MS = 10_000;
const PER_PAGE = 200;
/** Safety cap: 10 pages = 2000 leads, far more than 90 days of CRM leads. */
const MAX_PAGES = 10;
const FIELDS = "Full_Name,Lead_Source,Produto,Company,Description,Created_Time,Lead_Status,Owner";

const crmLeadSchema = z
  .object({
    id: z.string(),
    Full_Name: z.string().nullish(),
    Lead_Source: z.string().nullish(),
    Produto: z.string().nullish(),
    Company: z.string().nullish(),
    Description: z.string().nullish(),
    Created_Time: z.string().nullish(),
    Lead_Status: z.string().nullish(),
    Owner: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  })
  .passthrough();
export type CrmLead = z.infer<typeof crmLeadSchema>;

const pageSchema = z.object({
  data: z.array(crmLeadSchema).default([]),
  info: z.object({ more_records: z.boolean().optional() }).partial().optional(),
});

/** Which CRM-owned channel a lead belongs to, or null when it is not one of them. */
export function crmChannelOf(l: Pick<CrmLead, "Lead_Source" | "Produto" | "Company" | "Description">): string | null {
  const text = norm([l.Lead_Source, l.Produto, l.Company, l.Description].map((v) => v ?? "").join(" "));
  if (text.includes("CARAVELA")) return "LEAD_CARAVELA";
  if (norm(l.Lead_Source ?? "") === "FORM SIMULADOR") return "LEAD_ASISA";
  return null;
}

/** A CRM lead is still open until it is converted or marked as won or lost. */
export function crmLeadAberto(status: string | null | undefined): boolean {
  return !/CONTRATAD|CONVERTID|PERDID|FECHAD|LOST|JUNK|NAO QUALIFICAD/.test(norm(status ?? ""));
}

export const CRM_LEAD_URL = (id: string): string => `https://crm.zoho.com/crm/tab/Leads/${encodeURIComponent(id)}`;

/** Lead row for the dashboard and the email, from one CRM lead. */
export function crmLeadToRow(l: CrmLead, def: ChannelDef, semResponsavel: string): LeadRow | null {
  if (!l.Created_Time) return null;
  const produto = (l.Produto ?? "").trim();
  const nome = (l.Full_Name ?? "").trim();
  const ownerId = l.Owner?.id ?? null;
  // The type comes from the product: the simulator also sells travel and pet cover.
  const tipo = classifyTipo({ ...def, tipoFixo: undefined }, produto, l.Lead_Source);
  return {
    id: l.id,
    ticketNumber: "",
    subject: [nome || "(sem nome)", produto].filter(Boolean).join(" · "),
    status: (l.Lead_Status ?? "—").trim() || "—",
    channelKey: def.key,
    channelLabel: def.label,
    channelColor: def.color,
    createdTime: l.Created_Time,
    day: dayLisbon(l.Created_Time),
    tipo,
    assigneeId: ownerId,
    assigneeName: (l.Owner?.name ?? "").trim() || semResponsavel,
    aberto: crmLeadAberto(l.Lead_Status),
    url: CRM_LEAD_URL(l.id),
  };
}

export class CrmConfigError extends Error {}

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...(init ?? {}), signal: AbortSignal.timeout(CRM_TIMEOUT_MS) });

let auth: ZohoAuth | null = null;

/**
 * CRM access uses ZOHO_CRM_* when set. Otherwise it tries the Desk app's
 * credentials (same Zoho account), which only works if that token also has a
 * CRM read scope. The caller falls back to Desk when the CRM call fails.
 */
function getAuth(): ZohoAuth {
  if (auth) return auth;
  const cfg = env();
  const clientId = cfg.ZOHO_CRM_CLIENT_ID ?? cfg.ZOHO_DESK_CLIENT_ID;
  const clientSecret = cfg.ZOHO_CRM_CLIENT_SECRET ?? cfg.ZOHO_DESK_CLIENT_SECRET;
  const refreshToken = cfg.ZOHO_CRM_REFRESH_TOKEN ?? cfg.ZOHO_DESK_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new CrmConfigError("Zoho CRM não configurado (ZOHO_CRM_CLIENT_ID, ZOHO_CRM_CLIENT_SECRET, ZOHO_CRM_REFRESH_TOKEN).");
  }
  auth = new ZohoAuth({ clientId, clientSecret, refreshToken, fetch: timeoutFetch });
  return auth;
}

/**
 * CRM leads created in [from, to] (inclusive, Lisbon days). Reads the lead list
 * newest first and stops once a page goes past `from`: the CRM search API does
 * not filter on Created_Time.
 */
export async function fetchCrmLeads(from: string, to: string): Promise<CrmLead[]> {
  const a = getAuth();
  const base = env().ZOHO_CRM_API_BASE.replace(/\/+$/, "");
  const out: CrmLead[] = [];
  // Pad one day each side: Created_Time is UTC, the period is in Lisbon days.
  const padFrom = addDays(from, -1);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}/crm/v2/Leads?sort_by=Created_Time&sort_order=desc&per_page=${PER_PAGE}&page=${page}&fields=${FIELDS}`;
    const res = await timeoutFetch(url, { headers: { Authorization: `Zoho-oauthtoken ${await a.getAccessToken()}` } });
    if (res.status === 204) break;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zoho CRM leads ${res.status}: ${body.slice(0, 300)}`);
    }
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`Zoho CRM leads: resposta inesperada (${parsed.error.message.slice(0, 200)})`);
    const data = parsed.data.data;
    let pastStart = false;
    for (const l of data) {
      if (!l.Created_Time) continue;
      const day = dayLisbon(l.Created_Time);
      if (day < padFrom) {
        pastStart = true;
        continue;
      }
      if (day >= from && day <= to) out.push(l);
    }
    if (pastStart || !parsed.data.info?.more_records || data.length < PER_PAGE) break;
  }
  return out;
}

/** CRM leads of the CRM-owned channels in [from, to], as dashboard rows. */
export async function fetchCrmLeadRows(from: string, to: string, semResponsavel: string): Promise<LeadRow[]> {
  const leads = await fetchCrmLeads(from, to);
  const rows: LeadRow[] = [];
  for (const l of leads) {
    const key = crmChannelOf(l);
    const def = key ? CHANNEL_BY_KEY.get(key) : undefined;
    if (!def) continue;
    const r = crmLeadToRow(l, def, semResponsavel);
    if (r) rows.push(r);
  }
  return rows;
}
