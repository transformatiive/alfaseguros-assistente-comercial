import { and, asc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, ticketsTable } from "@workspace/db";

/**
 * "Tickets em risco" — open tickets assigned to this agent that have been open
 * for more than 24 hours.
 *
 * The age threshold is a business rule, not a constant to tune casually: it is
 * the SLA the team works to, and it is the same 24 hours the follow-up payload
 * reports as `follow_up_sla_hours`.
 */
export const RISCO_THRESHOLD_HOURS = 24;

export interface TicketEmRisco {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  idadeHoras: number;
  criadoEm: string;
  deskUrl: string;
  /** Who the ticket is with. A row without a name is a row you cannot act on. */
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

/**
 * The requester's email, dug out of the stored Desk payload.
 *
 * There is no column for it: the sync keeps the whole ticket in `rawJson` and
 * we never needed the address until the panel started saying *how* to reach
 * the person. Desk puts it in two places depending on the channel — top level
 * for email tickets, on the embedded contact otherwise — so both are tried.
 *
 * Deliberately total: a shape we did not expect returns null rather than
 * throwing, because an unreadable address must not take down the whole block.
 */
export function emailDoTicket(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const raw = rawJson as Record<string, unknown>;
  const direto = typeof raw.email === "string" ? raw.email.trim() : "";
  if (direto) return direto;
  const contacto = raw.contact;
  if (contacto && typeof contacto === "object") {
    const e = (contacto as Record<string, unknown>).email;
    if (typeof e === "string" && e.trim()) return e.trim();
  }
  return null;
}

/**
 * The portal slug in a Desk URL. Zoho routes on this name, never on the
 * numeric org id — which is the whole of the bug this replaced.
 */
export const PORTAL_DESK = "alfaseguros";

/**
 * Desk deep link for a ticket.
 *
 * Exported because every task with a ticket deserves one, not just the rows
 * that came *from* the ticket table: a promise made on a call carries a
 * `linked_ticket_id` and used to render without a way to reach it, which left
 * the agent knowing the ticket number and having to search for it by hand.
 *
 * ## Ask Zoho for the link; only build one when Zoho has not said
 *
 * The previous version built `/agent/{orgId}/tickets/details/{id}` and every
 * link 404'd. The agent console routes on the **portal name**; the org id is
 * an API identifier and means nothing to it. Guessing a second URL shape
 * would be the same mistake with a different string.
 *
 * So the ticket sync now asks Desk for `webUrl` and it lands in `raw_json`.
 * A link the other system hands us cannot be wrong about that system's own
 * routing, and it survives Zoho changing the shape again.
 *
 * The fallback is for tickets synced before `webUrl` was requested, and uses
 * the classic portal URL that the daily email has been sending for months —
 * a shape with evidence behind it rather than a fresh guess.
 */
export function urlDoDesk(ticketId: string, raw?: unknown): string {
  if (raw && typeof raw === "object") {
    const web = (raw as Record<string, unknown>).webUrl;
    if (typeof web === "string" && web.startsWith("https://")) return web;
  }
  return `https://desk.zoho.com/support/${PORTAL_DESK}/ShowHomePage.do#Cases/dv/${encodeURIComponent(ticketId)}`;
}

/** Hours between `createdTime` and `now`, rounded down. */
export function idadeEmHoras(criadoEm: Date, now: Date): number {
  return Math.floor((now.getTime() - criadoEm.getTime()) / 3_600_000);
}

/**
 * Open tickets assigned to `zid`, older than the threshold, oldest first.
 *
 * "Open" is `statusType <> 'Closed'`, with a null `statusType` treated as open:
 * Desk leaves it unset on some channels, and a ticket that might be open is
 * better surfaced than silently dropped from the agent's list.
 */
export async function listTicketsEmRisco(params: {
  zid: string;
  orgId?: string;
  now?: Date;
}): Promise<TicketEmRisco[]> {
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - RISCO_THRESHOLD_HOURS * 3_600_000);

  const rows = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.assigneeId, params.zid),
        or(ne(ticketsTable.statusType, "Closed"), isNull(ticketsTable.statusType)),
        lt(ticketsTable.createdTime, cutoff),
      ),
    )
    .orderBy(asc(ticketsTable.createdTime));

  return rows.flatMap((t) => {
    // The `lt` above already excludes nulls, but the column is nullable and
    // the type says so — narrow rather than assert.
    if (!t.createdTime) return [];
    return [
      {
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        status: t.status,
        idadeHoras: idadeEmHoras(t.createdTime, now),
        criadoEm: t.createdTime.toISOString(),
        deskUrl: urlDoDesk(t.id, t.rawJson),
        contactName: t.contactName,
        contactPhone: t.contactPhone,
        contactEmail: emailDoTicket(t.rawJson),
      },
    ];
  });
}

/**
 * Desk links for a set of ticket ids, read from what Desk itself told us.
 *
 * Built in one query rather than per row: a panel routinely references thirty
 * or forty tickets, and thirty round trips to save a `WHERE id IN` is a cost
 * with nothing bought.
 *
 * Ids with no row, or rows synced before `webUrl` was requested, are simply
 * absent — the caller falls back to `urlDoDesk`, which is the point of that
 * function having a fallback at all.
 */
export async function urlsDeTickets(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return new Map();

  const rows = await db
    .select({ id: ticketsTable.id, rawJson: ticketsTable.rawJson })
    .from(ticketsTable)
    .where(inArray(ticketsTable.id, unicos));

  const mapa = new Map<string, string>();
  for (const r of rows) {
    const web = r.rawJson && typeof r.rawJson === "object"
      ? (r.rawJson as Record<string, unknown>).webUrl
      : null;
    if (typeof web === "string" && web.startsWith("https://")) mapa.set(r.id, web);
  }
  return mapa;
}
