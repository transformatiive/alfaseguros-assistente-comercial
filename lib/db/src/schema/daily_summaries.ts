import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailySummariesTable = pgTable("daily_summaries", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  workingWell: text("working_well").array().notNull().default([]),
  toImprove: text("to_improve").array().notNull().default([]),
  risks: text("risks").array().notNull().default([]),
  closingRateRecommendations: text("closing_rate_recommendations").array().notNull().default([]),
  automationOpportunities: text("automation_opportunities").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDailySummarySchema = createInsertSchema(dailySummariesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;
export type DailySummary = typeof dailySummariesTable.$inferSelect;
