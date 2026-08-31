import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Operators (colaboradores) resolved from the call agent. For Vida the identity
 * comes from the Ringover `user_id` (no Zoho Desk). `equipa` is the real team
 * from the Ringover contacts export — not the old "everything-not-360 = vida"
 * heuristic. ADMIN / MKT are non-commercial and simply won't get a checklist.
 */
export const colaboradoresTable = pgTable("colaboradores", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  // Ringover user_id as digits — matches conversations.agent_id (text).
  ringoverUserId: text("ringover_user_id").unique(),
  // Zoho Desk agent id (ZID) — null for Vida, which has no Desk.
  zid: text("zid"),
  // Zoho CRM user id — the CRM-side identity join for the agent panel.
  // Nullable: only the 360 team that gets the panel needs one.
  crmUserId: text("crm_user_id").unique(),
  email: text("email"),
  telefone: text("telefone"),
  equipa: text("equipa", {
    enum: ["360", "vida", "admin", "mkt", "sinistros"],
  }).notNull(),
  // What this person may see in the agent panel. `agente` sees only their own
  // work, `supervisor` also sees the team view, `nenhum` has no panel access.
  // Defaults to `agente` so an existing row is never accidentally promoted.
  papel: text("papel", {
    enum: ["agente", "supervisor", "nenhum"],
  }).notNull().default("agente"),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertColaboradorSchema = createInsertSchema(colaboradoresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertColaborador = z.infer<typeof insertColaboradorSchema>;
export type Colaborador = typeof colaboradoresTable.$inferSelect;
