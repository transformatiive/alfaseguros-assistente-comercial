import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations.js";
import { checklistCategoriesTable, checklistItemsTable } from "./checklist.js";
import { colaboradoresTable } from "./colaboradores.js";

/** Four-valued point state. Only cumprido/nao_cumprido count toward the rate. */
export const ESTADOS = ["cumprido", "nao_cumprido", "nao_aplicavel", "indeterminado"] as const;

/**
 * Per-call (conversation) evaluation of one checklist point. One row per
 * applicable point per call; the unique index enforces that and makes
 * re-analysis idempotent (upsert on conflict).
 */
export const callChecklistResultsTable = pgTable(
  "call_checklist_results",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    itemId: integer("item_id").notNull().references(() => checklistItemsTable.id),
    colaboradorId: integer("colaborador_id").references(() => colaboradoresTable.id),
    estado: text("estado", { enum: ESTADOS }).notNull(),
    // Short quote / justification from the transcript, when available.
    evidencia: text("evidencia"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    convItemUniq: uniqueIndex("call_checklist_results_conv_item_uniq").on(t.conversationId, t.itemId),
    colaboradorIdx: index("call_checklist_results_colaborador_idx").on(t.colaboradorId),
    itemIdx: index("call_checklist_results_item_idx").on(t.itemId),
  }),
);

export const insertCallChecklistResultSchema = createInsertSchema(callChecklistResultsTable).omit({ id: true, criadoEm: true, atualizadoEm: true });
export type InsertCallChecklistResult = z.infer<typeof insertCallChecklistResultSchema>;
export type CallChecklistResult = typeof callChecklistResultsTable.$inferSelect;

/** What a category_summary describes. */
export const SUMMARY_ESCOPOS = ["chamada", "colaborador_periodo", "equipa_periodo"] as const;

/**
 * AI-generated per-category summary at a given scope. `sistemico` + `destaque*`
 * are only set when coverage ≥ MIN_CHAMADAS_PADRAO (the honesty guardrail lives
 * in the generator, not here).
 */
export const categorySummariesTable = pgTable(
  "category_summaries",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").notNull().references(() => checklistCategoriesTable.id),
    escopo: text("escopo", { enum: SUMMARY_ESCOPOS }).notNull(),
    // Id of the thing summarised: conversationId | colaboradorId | equipa name.
    refId: text("ref_id").notNull(),
    periodoDe: text("periodo_de"), // YYYY-MM-DD (period scopes)
    periodoAte: text("periodo_ate"),
    textoSumario: text("texto_sumario").notNull().default(""),
    destaqueItemId: integer("destaque_item_id").references(() => checklistItemsTable.id),
    destaqueExemplo: text("destaque_exemplo"),
    sistemico: boolean("sistemico").notNull().default(false),
    geradoEm: timestamp("gerado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    catScopeIdx: index("category_summaries_cat_scope_idx").on(t.categoryId, t.escopo, t.refId),
  }),
);

export type CategorySummary = typeof categorySummariesTable.$inferSelect;

/** Notification channels and delivery states for the alert digest. */
export const ALERT_CANAIS = ["email", "cliq", "desk"] as const;
export const ALERT_ESTADOS = ["pendente", "enviado", "falhado"] as const;

/**
 * One row per eligible non-compliance that became alert-worthy. The unique
 * (conversation, item) index is the idempotency guard: re-analysis with
 * force=true never produces a duplicate alert for the same (call, point).
 */
export const alertLogTable = pgTable(
  "alert_log",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    itemId: integer("item_id").notNull().references(() => checklistItemsTable.id),
    colaboradorId: integer("colaborador_id").references(() => colaboradoresTable.id),
    canal: text("canal", { enum: ALERT_CANAIS }).notNull().default("email"),
    estadoEnvio: text("estado_envio", { enum: ALERT_ESTADOS }).notNull().default("pendente"),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convItemUniq: uniqueIndex("alert_log_conv_item_uniq").on(t.conversationId, t.itemId),
    colaboradorIdx: index("alert_log_colaborador_idx").on(t.colaboradorId),
  }),
);

export const insertAlertLogSchema = createInsertSchema(alertLogTable).omit({ id: true, criadoEm: true });
export type InsertAlertLog = z.infer<typeof insertAlertLogSchema>;
export type AlertLog = typeof alertLogTable.$inferSelect;
