import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const emptySection = { paragraph: "", bullets: [] };
const emptyAutomation = { paragraph: "", items: [] };

export const dailySummariesTable = pgTable("daily_summaries", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  executiveSummary: text("executive_summary").notNull().default(""),
  workingWell: jsonb("working_well").notNull().default(emptySection),
  toImprove: jsonb("to_improve").notNull().default(emptySection),
  risks: jsonb("risks").notNull().default(emptySection),
  closingRateRecommendations: jsonb("closing_rate_recommendations").notNull().default(emptySection),
  automationOpportunities: jsonb("automation_opportunities").notNull().default(emptyAutomation),
  /** Lazily generated per-team summaries (360 / vida). Null until first GET /api/email/summary. */
  teamSummariesJson: jsonb("team_summaries_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDailySummarySchema = createInsertSchema(dailySummariesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;
export type DailySummary = typeof dailySummariesTable.$inferSelect;
