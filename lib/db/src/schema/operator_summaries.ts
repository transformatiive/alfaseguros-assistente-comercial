import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const operatorSummariesTable = pgTable("operator_summaries", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  operatorId: text("operator_id").notNull(),
  operatorName: text("operator_name").notNull(),
  paragraphOverview: text("paragraph_overview").notNull().default(""),
  strengths: text("strengths").array().notNull().default([]),
  blindSpots: text("blind_spots").array().notNull().default([]),
  closingRateObservations: text("closing_rate_observations").notNull().default(""),
  coachingRecommendations: text("coaching_recommendations").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOperatorSummarySchema = createInsertSchema(operatorSummariesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperatorSummary = z.infer<typeof insertOperatorSummarySchema>;
export type OperatorSummary = typeof operatorSummariesTable.$inferSelect;
