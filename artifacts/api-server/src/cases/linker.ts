import { phoneFingerprint } from "@workspace/phone";
import type { ZohoComment, ZohoTicket } from "@workspace/zoho-desk";
import type { GroupedConversation } from "../grouping/conversations.js";

/** ±14-day window between any ticket activity and a call to count as the same case. */
export const CASE_PROXIMITY_DAYS = 14;
const CASE_PROXIMITY_MS = CASE_PROXIMITY_DAYS * 86_400_000;

export type LegKind = "call" | "ticket_event" | "ticket_comment";

export interface CaseLeg {
  kind: LegKind;
  at: string; // ISO 8601
  refId: string; // ticket id, comment id, or conversation row id (as string)
  /** Human-readable label, e.g. "Inbound call", "Ticket aberto", "Comentário Email". */
  label: string;
  /** Detail string fed to the case-level analyzer. */
  detail: string;
  agentName?: string | null;
  channel?: string | null;
}

export interface LinkedCase {
  id: string;
  /** Human-friendly customer phone (digits-only as captured upstream). */
  customerPhone: string | null;
  phoneFingerprint: string;
  customerName: string | null;
  productName: string | null;
  primaryAgentId: string | null;
  primaryAgentName: string | null;
  ticketIds: string[];
  conversationIds: number[];
  legs: CaseLeg[];
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

export interface BuildCasesInput {
  /** Conversations the worker just produced (with their persisted DB ids). */
  conversations: Array<GroupedConversation & { rowId: number }>;
  tickets: ZohoTicket[];
  /** Comments grouped by ticket id (or flat — we'll filter). */
  comments: ZohoComment[];
}

interface AnchorIndex {
  ticket: ZohoTicket;
  fingerprint: string;
  /** Sorted list of activity timestamps (ms) — created/modified/closed + comments. */
  activityMs: number[];
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function fingerprintFromTicket(t: ZohoTicket): string {
  const phone =
    (t.contact?.phone as string | null | undefined) ??
    (t.contact?.mobile as string | null | undefined) ??
    null;
  return phoneFingerprint(phone);
}

function ticketActivityTimestamps(t: ZohoTicket, comments: ZohoComment[]): number[] {
  const stamps: number[] = [];
  const created = parseMs(t.createdTime);
  const modified = parseMs(t.modifiedTime);
  const closed = parseMs(t.closedTime);
  if (created != null) stamps.push(created);
  if (modified != null) stamps.push(modified);
  if (closed != null) stamps.push(closed);
  for (const c of comments) {
    const cTime = parseMs(c.commentedTime);
    if (cTime != null) stamps.push(cTime);
  }
  return stamps.sort((a, b) => a - b);
}

function nearestDistance(target: number, sortedStamps: number[]): number {
  if (sortedStamps.length === 0) return Infinity;
  let best = Infinity;
  for (const s of sortedStamps) {
    const d = Math.abs(target - s);
    if (d < best) best = d;
    if (s > target + best) break;
  }
  return best;
}

function customerNameFromContact(t: ZohoTicket): string | null {
  const c = t.contact;
  if (!c) return null;
  const full = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  return full || c.email || null;
}

function ticketLabel(t: ZohoTicket): string {
  return `Ticket #${t.ticketNumber ?? t.id} — ${t.subject ?? "(sem assunto)"}`;
}

function commentLabel(c: ZohoComment): string {
  const channel = c.channel ?? "comentário";
  const author = c.commenter
    ? `${c.commenter.firstName ?? ""} ${c.commenter.lastName ?? ""}`.trim()
    : "(autor)";
  const type = (c.authorType ?? c.commenter?.type ?? "AGENT").toUpperCase();
  return `Comentário (${channel}, ${author || "(autor)"}, ${type})`;
}

/** Strip basic HTML/entities and truncate. Per HANDOVER §4 (1500 char cap). */
export function sanitizeCommentContent(html: string | null | undefined, max = 1500): string {
  if (!html) return "";
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/**
 * Link calls and tickets into cross-channel cases per HANDOVER §4:
 *
 *  1. Each ticket starts a case (id = `case_t_<ticketId>`).
 *  2. A call joins the closest ticket case where its fingerprint matches and
 *     it's within ±14 days of any ticket activity.
 *  3. Calls without any matching ticket form an orphan case
 *     (id = `case_p_<fingerprint>_<YYYY-MM-DD>`).
 *  4. Tickets without a matching phone fingerprint still get a case (no calls
 *     attached) so the pipeline view shows them.
 */
export function buildCases(input: BuildCasesInput): LinkedCase[] {
  const commentsByTicket = new Map<string, ZohoComment[]>();
  for (const c of input.comments) {
    const tid = (c as ZohoComment & { ticketId?: string }).ticketId;
    if (typeof tid !== "string") continue;
    const list = commentsByTicket.get(tid) ?? [];
    list.push(c);
    commentsByTicket.set(tid, list);
  }

  const anchors: AnchorIndex[] = input.tickets.map((t) => ({
    ticket: t,
    fingerprint: fingerprintFromTicket(t),
    activityMs: ticketActivityTimestamps(t, commentsByTicket.get(t.id) ?? []),
  }));
  const anchorsByFp = new Map<string, AnchorIndex[]>();
  for (const a of anchors) {
    if (!a.fingerprint) continue;
    const list = anchorsByFp.get(a.fingerprint) ?? [];
    list.push(a);
    anchorsByFp.set(a.fingerprint, list);
  }

  // Initialise a case per ticket.
  const cases = new Map<string, LinkedCase>();
  for (const a of anchors) {
    const t = a.ticket;
    const id = `case_t_${t.id}`;
    const legs: CaseLeg[] = [];
    const created = parseMs(t.createdTime);
    if (created != null) {
      legs.push({
        kind: "ticket_event",
        at: new Date(created).toISOString(),
        refId: t.id,
        label: ticketLabel(t),
        detail: `Canal: ${t.channel ?? "?"} · Categoria: ${t.category ?? "?"}`,
        channel: t.channel ?? null,
      });
    }
    const ticketComments = commentsByTicket.get(t.id) ?? [];
    for (const c of ticketComments) {
      const at = parseMs(c.commentedTime);
      if (at == null) continue;
      const author = c.commenter
        ? `${c.commenter.firstName ?? ""} ${c.commenter.lastName ?? ""}`.trim() || null
        : null;
      legs.push({
        kind: "ticket_comment",
        at: new Date(at).toISOString(),
        refId: c.id,
        label: commentLabel(c),
        detail: sanitizeCommentContent(c.content),
        agentName: author,
        channel: c.channel ?? null,
      });
    }

    const stamps = a.activityMs;
    cases.set(id, {
      id,
      customerPhone: a.fingerprint || null,
      phoneFingerprint: a.fingerprint,
      customerName: customerNameFromContact(t),
      productName: t.productName ?? null,
      primaryAgentId: t.assigneeId ?? null,
      primaryAgentName: t.assignee
        ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || null
        : null,
      ticketIds: [t.id],
      conversationIds: [],
      legs,
      firstActivityAt: stamps.length ? new Date(stamps[0]).toISOString() : null,
      lastActivityAt: stamps.length ? new Date(stamps[stamps.length - 1]).toISOString() : null,
    });
  }

  // Match each conversation: best (smallest distance) ticket within window, else orphan.
  for (const conv of input.conversations) {
    const fp = phoneFingerprint(conv.customerPhone);
    if (!fp) continue;
    const callMs = parseMs(conv.startTime ?? null) ?? Date.now();

    let bestCaseId: string | null = null;
    let bestDistance = Infinity;
    const candidates = anchorsByFp.get(fp) ?? [];
    for (const a of candidates) {
      const d = nearestDistance(callMs, a.activityMs);
      if (d <= CASE_PROXIMITY_MS && d < bestDistance) {
        bestDistance = d;
        bestCaseId = `case_t_${a.ticket.id}`;
      }
    }

    if (bestCaseId == null) {
      const dateStr = new Date(callMs).toISOString().slice(0, 10);
      bestCaseId = `case_p_${fp}_${dateStr}`;
      if (!cases.has(bestCaseId)) {
        cases.set(bestCaseId, {
          id: bestCaseId,
          customerPhone: conv.customerPhone,
          phoneFingerprint: fp,
          customerName: null,
          productName: null,
          primaryAgentId: conv.agentId,
          primaryAgentName: conv.agentName,
          ticketIds: [],
          conversationIds: [],
          legs: [],
          firstActivityAt: null,
          lastActivityAt: null,
        });
      }
    }

    const c = cases.get(bestCaseId)!;
    c.conversationIds.push(conv.rowId);
    if (!c.customerPhone) c.customerPhone = conv.customerPhone;
    if (!c.primaryAgentId && conv.agentId) {
      c.primaryAgentId = conv.agentId;
      c.primaryAgentName = conv.agentName;
    }
    for (const leg of conv.legs) {
      const at = leg.startTime ?? new Date(callMs).toISOString();
      c.legs.push({
        kind: "call",
        at,
        refId: String(conv.rowId),
        label:
          leg.direction === "out" || leg.direction === "outbound"
            ? "Chamada Outbound"
            : leg.direction === "in" || leg.direction === "inbound"
              ? "Chamada Inbound"
              : "Chamada",
        detail: leg.ringoverSummary,
        agentName: leg.agentName,
      });
    }
  }

  // Sort each case's legs chronologically and refresh the activity bounds.
  for (const c of cases.values()) {
    c.legs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (c.legs.length > 0) {
      c.firstActivityAt = c.legs[0].at;
      c.lastActivityAt = c.legs[c.legs.length - 1].at;
    }
  }

  return [...cases.values()].sort((a, b) =>
    (a.lastActivityAt ?? "") < (b.lastActivityAt ?? "") ? 1 : -1,
  );
}
