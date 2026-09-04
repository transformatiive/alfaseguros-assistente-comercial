import { and, asc, eq, isNull, lt, ne, or } from "drizzle-orm";
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

/** Desk deep link. Built from the ticket id, which is what Desk routes on. */
function deskUrl(ticketId: string, orgId: string | undefined): string {
  // Without an org id there is no valid tenant path, so fall back to the
  // generic agent URL rather than emitting a link that 404s.
  if (!orgId) return `https://desk.zoho.com/agent/tickets/details/${encodeURIComponent(ticketId)}`;
  return `https://desk.zoho.com/agent/${encodeURIComponent(orgId)}/tickets/details/${encodeURIComponent(ticketId)}`;
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
        deskUrl: deskUrl(t.id, params.orgId),
        contactName: t.contactName,
        contactPhone: t.contactPhone,
        contactEmail: emailDoTicket(t.rawJson),
      },
    ];
  });
}
