import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Sales-script phases. The MVP only seeds `primeiro_contacto` (Fase 1). */
export const FASES = ["primeiro_contacto", "follow_up", "proposta", "pos_venda"] as const;

/**
 * A checklist category (the primary unit of reporting). Scoped by `escopo`
 * (team / product, e.g. "vida"), so each team can have its own checklist while
 * sharing the generic categories. `obrigatoria` is data, not code (R7): the
 * coordination can flip it without a deploy.
 */
export const checklistCategoriesTable = pgTable(
  "checklist_categories",
  {
    id: serial("id").primaryKey(),
    // Team / product this category belongs to. Free-form (not an enum) so a new
    // product checklist can be added without a migration.
    escopo: text("escopo").notNull().default("vida"),
    fase: text("fase", { enum: FASES }).notNull(),
    nome: text("nome").notNull(),
    obrigatoria: boolean("obrigatoria").notNull().default(false),
    ordem: integer("ordem").notNull().default(0),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    escopoFaseIdx: index("checklist_categories_escopo_fase_idx").on(t.escopo, t.fase),
  }),
);

export const insertChecklistCategorySchema = createInsertSchema(checklistCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChecklistCategory = z.infer<typeof insertChecklistCategorySchema>;
export type ChecklistCategory = typeof checklistCategoriesTable.$inferSelect;

/**
 * A single validation point within a category. `condicional` points only apply
 * when their condition occurred (otherwise `nao_aplicavel`). `compliance` points
 * are always mandatory at the point level — they trigger alerts even when the
 * category is healthy and not marked `obrigatoria`. Both flags are data (R7).
 */
export const checklistItemsTable = pgTable(
  "checklist_items",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").notNull().references(() => checklistCategoriesTable.id),
    // Short label (the "Validação" column in the catalogue).
    validacao: text("validacao").notNull().default(""),
    // Full point text (the "Ponto" column).
    texto: text("texto").notNull(),
    condicional: boolean("condicional").notNull().default(false),
    // When conditional, the human/LLM-readable triggering condition.
    condicaoDescricao: text("condicao_descricao"),
    compliance: boolean("compliance").notNull().default(false),
    // Coaching message sent on non-compliance. Editable without a deploy.
    mensagemMelhoria: text("mensagem_melhoria").notNull().default(""),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    categoryIdx: index("checklist_items_category_id_idx").on(t.categoryId),
  }),
);

export const insertChecklistItemSchema = createInsertSchema(checklistItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChecklistItem = z.infer<typeof insertChecklistItemSchema>;
export type ChecklistItem = typeof checklistItemsTable.$inferSelect;
