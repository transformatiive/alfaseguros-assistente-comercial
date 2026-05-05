import { pgTable, serial, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Mirrored Zoho Desk tickets. We keep the raw `cf_*` blob in `customFieldsJson`
 * — the outcome classifier reads it. `phoneFingerprint` is the last 9 digits
 * of the contact's phone, used to join with calls.
 */
export const ticketsTable = pgTable(
  "tickets",
  {
    id: text("id").primaryKey(), // Zoho ticket id
    ticketNumber: text("ticket_number"),
    subject: text("subject"),
    status: text("status"),
    statusType: text("status_type"),
    channel: text("channel"),
    category: text("category"),
    productName: text("product_name"),
    resolution: text("resolution"),
    contactId: text("contact_id"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    phoneFingerprint: text("phone_fingerprint"),
    assigneeId: text("assignee_id"),
    assigneeName: text("assignee_name"),
    customFieldsJson: jsonb("custom_fields_json"),
    rawJson: jsonb("raw_json"),
    outcomeStatus: text("outcome_status"), // won | lost | open | unknown
    outcomeReason: text("outcome_reason"),
    createdTime: timestamp("created_time", { withTimezone: true }),
    modifiedTime: timestamp("modified_time", { withTimezone: true }),
    closedTime: timestamp("closed_time", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fingerprintIdx: index("tickets_phone_fingerprint_idx").on(t.phoneFingerprint),
    modifiedIdx: index("tickets_modified_time_idx").on(t.modifiedTime),
  }),
);

export type Ticket = typeof ticketsTable.$inferSelect;

export const ticketCommentsTable = pgTable(
  "ticket_comments",
  {
    id: text("id").primaryKey(), // Zoho comment id
    ticketId: text("ticket_id").notNull(),
    commentedTime: timestamp("commented_time", { withTimezone: true }),
    channel: text("channel"),
    direction: text("direction"),
    authorType: text("author_type"), // AGENT | END_USER | SYSTEM
    authorName: text("author_name"),
    contentSanitized: text("content_sanitized").notNull().default(""),
    rawJson: jsonb("raw_json"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketIdx: index("ticket_comments_ticket_id_idx").on(t.ticketId),
    commentedIdx: index("ticket_comments_commented_time_idx").on(t.commentedTime),
  }),
);

export type TicketComment = typeof ticketCommentsTable.$inferSelect;

/** Last-successful sync window per anchor. Powers idempotent re-syncs. */
export const ticketSyncStateTable = pgTable("ticket_sync_state", {
  id: serial("id").primaryKey(),
  anchor: text("anchor").notNull().default("default"),
  windowFrom: timestamp("window_from", { withTimezone: true }).notNull(),
  windowTo: timestamp("window_to", { withTimezone: true }).notNull(),
  ticketCount: text("ticket_count").notNull().default("0"),
  commentCount: text("comment_count").notNull().default("0"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketSyncState = typeof ticketSyncStateTable.$inferSelect;
