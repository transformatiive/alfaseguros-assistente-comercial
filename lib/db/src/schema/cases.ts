import { pgTable, serial, text, jsonb, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";

/**
 * A case is a multi-channel customer engagement: calls + tickets + comments.
 * Anchored on a Desk ticket (id = `case_t_<ticketId>`) when one exists, or on
 * a phone+date orphan (id = `case_p_<fingerprint>_<YYYY-MM-DD>`) otherwise.
 * Per HANDOVER §4.
 */
export const casesTable = pgTable(
  "cases",
  {
    id: text("id").primaryKey(),
    customerPhone: text("customer_phone"),
    phoneFingerprint: text("phone_fingerprint").notNull(),
    customerName: text("customer_name"),
    productName: text("product_name"),
    primaryAgentId: text("primary_agent_id"),
    primaryAgentName: text("primary_agent_name"),
    /** Earliest activity (call or ticket event) in the case. */
    firstActivityAt: timestamp("first_activity_at", { withTimezone: true }),
    /** Latest activity — used to sort the pipeline view. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    outcomeStatus: text("outcome_status").notNull().default("unknown"), // won | lost | open | unknown
    outcomeReason: text("outcome_reason"),
    /** Case-level analysis from the LLM (same shape as ConversationAnalysis). */
    analysisJson: jsonb("analysis_json"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    /** Chronological timeline of legs (calls + ticket events + comments). */
    timelineJson: jsonb("timeline_json").notNull().default([]),
    legCount: integer("leg_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    fingerprintIdx: index("cases_phone_fingerprint_idx").on(t.phoneFingerprint),
    lastActivityIdx: index("cases_last_activity_idx").on(t.lastActivityAt),
    outcomeIdx: index("cases_outcome_status_idx").on(t.outcomeStatus),
  }),
);

export type Case = typeof casesTable.$inferSelect;

export const caseTicketsTable = pgTable(
  "case_tickets",
  {
    id: serial("id").primaryKey(),
    caseId: text("case_id").notNull(),
    ticketId: text("ticket_id").notNull(),
  },
  (t) => ({
    caseIdx: index("case_tickets_case_id_idx").on(t.caseId),
    ticketIdx: index("case_tickets_ticket_id_idx").on(t.ticketId),
  }),
);

export type CaseTicket = typeof caseTicketsTable.$inferSelect;

export const caseCallsTable = pgTable(
  "case_calls",
  {
    id: serial("id").primaryKey(),
    caseId: text("case_id").notNull(),
    /** Reference to a row in `conversations`. */
    conversationId: integer("conversation_id").notNull(),
  },
  (t) => ({
    caseIdx: index("case_calls_case_id_idx").on(t.caseId),
    convIdx: index("case_calls_conversation_id_idx").on(t.conversationId),
  }),
);

export type CaseCall = typeof caseCallsTable.$inferSelect;
