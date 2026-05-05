import { eq } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketCommentsTable,
  ticketSyncStateTable,
} from "@workspace/db";
import { ZohoDeskClient, type ZohoComment, type ZohoTicket } from "@workspace/zoho-desk";
import { phoneFingerprint } from "@workspace/phone";
import { classifyOutcome } from "../analysis/outcome.js";
import { sanitizeCommentContent } from "../cases/linker.js";

export interface SyncResult {
  ticketCount: number;
  commentCount: number;
  /** All tickets fetched in this sync (used by the case linker downstream). */
  tickets: ZohoTicket[];
  /** All comments fetched (each carries `ticketId` from the upstream context). */
  comments: Array<ZohoComment & { ticketId: string }>;
}

/**
 * Pull tickets created in `[from, to]` and their comment threads from Zoho
 * Desk, upsert them into Postgres, and return the in-memory shape for the
 * downstream case linker. Idempotent: re-running for the same window is safe.
 */
export async function syncTickets(
  client: ZohoDeskClient,
  from: Date,
  to: Date,
): Promise<SyncResult> {
  const tickets = await client.listTicketsCreatedBetween({
    createdTimeFrom: from.toISOString(),
    createdTimeTo: to.toISOString(),
  });

  const allComments: Array<ZohoComment & { ticketId: string }> = [];

  for (const t of tickets) {
    const phone =
      (t.contact?.phone as string | null | undefined) ??
      (t.contact?.mobile as string | null | undefined) ??
      null;
    const fingerprint = phoneFingerprint(phone);
    const outcome = classifyOutcome(t);
    const contactName = t.contact
      ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() || null
      : null;
    const assigneeName = t.assignee
      ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || null
      : null;

    const values = {
      id: t.id,
      ticketNumber: t.ticketNumber != null ? String(t.ticketNumber) : null,
      subject: t.subject ?? null,
      status: t.status ?? null,
      statusType: t.statusType ?? null,
      channel: t.channel ?? null,
      category: t.category ?? null,
      productName: t.productName ?? null,
      resolution: t.resolution ?? null,
      contactId: t.contactId ?? t.contact?.id ?? null,
      contactName,
      contactPhone: phone,
      phoneFingerprint: fingerprint || null,
      assigneeId: t.assigneeId ?? t.assignee?.id ?? null,
      assigneeName,
      customFieldsJson: (t.cf as Record<string, unknown>) ?? null,
      rawJson: t as unknown as Record<string, unknown>,
      outcomeStatus: outcome.status,
      outcomeReason: outcome.reason,
      createdTime: t.createdTime ? new Date(t.createdTime) : null,
      modifiedTime: t.modifiedTime ? new Date(t.modifiedTime) : null,
      closedTime: t.closedTime ? new Date(t.closedTime) : null,
      syncedAt: new Date(),
    };

    await db
      .insert(ticketsTable)
      .values(values)
      .onConflictDoUpdate({ target: ticketsTable.id, set: values });

    const comments = await client.listTicketComments(t.id);
    for (const c of comments) {
      allComments.push({ ...c, ticketId: t.id });
      const author = c.commenter
        ? `${c.commenter.firstName ?? ""} ${c.commenter.lastName ?? ""}`.trim() || null
        : null;
      const cValues = {
        id: c.id,
        ticketId: t.id,
        commentedTime: c.commentedTime ? new Date(c.commentedTime) : null,
        channel: c.channel ?? null,
        direction: c.direction ?? null,
        authorType: c.authorType ?? c.commenter?.type ?? null,
        authorName: author,
        contentSanitized: sanitizeCommentContent(c.content),
        rawJson: c as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      };
      await db
        .insert(ticketCommentsTable)
        .values(cValues)
        .onConflictDoUpdate({ target: ticketCommentsTable.id, set: cValues });
    }
  }

  await db.insert(ticketSyncStateTable).values({
    anchor: "default",
    windowFrom: from,
    windowTo: to,
    ticketCount: String(tickets.length),
    commentCount: String(allComments.length),
    syncedAt: new Date(),
  });

  return {
    ticketCount: tickets.length,
    commentCount: allComments.length,
    tickets,
    comments: allComments,
  };
}

// Drizzle's `eq` is imported above to keep the type-checker happy when
// extending this file with selective updates later.
void eq;
