import { pgTable, serial, text, integer, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  runDate: text("run_date").notNull(),
  customerPhone: text("customer_phone").notNull(),
  callIds: text("call_ids").array().notNull().default([]),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  durationSec: integer("duration_sec"),
  recordingUrls: text("recording_urls").array().notNull().default([]),
  legsJson: jsonb("legs_json").notNull().default([]),
  analysisJson: jsonb("analysis_json"),
  analysisError: text("analysis_error"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
