import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const runsTable = pgTable("runs", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  totalConversations: integer("total_conversations"),
  analyzedConversations: integer("analyzed_conversations"),
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRunSchema = createInsertSchema(runsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;
