import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { conversationsTable } from "./conversations";

/**
 * Tracks which follow-up promises have been emitted to Zoho Desk by n8n.
 * follow_up_id is "conv_{conversationId}" — stable and unique per follow-up.
 * Once a row exists, the follow-up no longer appears in GET /api/followups/pending.
 */
export const followUpAcksTable = pgTable(
  "follow_up_acks",
  {
    id: serial("id").primaryKey(),
    /** "conv_{conversationId}" — the ID used in the n8n contract */
    followUpId: text("follow_up_id").notNull().unique(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    /** Zoho Desk Task ID created by n8n */
    deskTaskId: text("desk_task_id").notNull(),
    /** When n8n emitted the task to Desk */
    emittedAt: timestamp("emitted_at", { withTimezone: true }).notNull(),
    /** "created" | "updated" — informational, from n8n dedup logic */
    dedup: text("dedup"),
    /** Set by POST /api/followups/close-loop when the Desk task is completed */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index("follow_up_acks_conversation_id_idx").on(t.conversationId),
    deskTaskIdx: index("follow_up_acks_desk_task_id_idx").on(t.deskTaskId),
  }),
);

export type FollowUpAck = typeof followUpAcksTable.$inferSelect;
