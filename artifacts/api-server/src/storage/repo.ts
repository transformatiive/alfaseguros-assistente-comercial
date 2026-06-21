import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import {
  db,
  conversationsTable,
  colaboradoresTable,
  checklistCategoriesTable,
  checklistItemsTable,
  callChecklistResultsTable,
  type Colaborador,
} from "@workspace/db";
import type { ChecklistItemForPrompt } from "../analysis/checklist-prompt.js";
import type { ChecklistPointResult } from "../analysis/checklist-schema.js";
import type { PointEvaluation, Estado } from "../analysis/category-stats.js";

/**
 * Thin Drizzle access layer for the Supervisor Virtual V2 (checklist). Per
 * CLAUDE.md, this is the ONLY place the DB client is touched for these tables —
 * routes and jobs call these functions, not Drizzle directly.
 */

type Fase = "primeiro_contacto" | "follow_up" | "proposta" | "pos_venda";

/**
 * Load the active checklist for a scope/phase, shaped for the LLM prompt.
 * Ordered by category then item order so the prompt is stable.
 */
export async function loadChecklistForPrompt(
  escopo: string,
  fase: Fase,
): Promise<ChecklistItemForPrompt[]> {
  const rows = await db
    .select({
      id: checklistItemsTable.id,
      categoria: checklistCategoriesTable.nome,
      validacao: checklistItemsTable.validacao,
      texto: checklistItemsTable.texto,
      condicional: checklistItemsTable.condicional,
      condicaoDescricao: checklistItemsTable.condicaoDescricao,
    })
    .from(checklistItemsTable)
    .innerJoin(
      checklistCategoriesTable,
      eq(checklistItemsTable.categoryId, checklistCategoriesTable.id),
    )
    .where(
      and(
        eq(checklistCategoriesTable.escopo, escopo),
        eq(checklistCategoriesTable.fase, fase),
        eq(checklistCategoriesTable.ativo, true),
        eq(checklistItemsTable.ativo, true),
      ),
    )
    .orderBy(checklistCategoriesTable.ordem, checklistItemsTable.ordem);

  return rows;
}

/** Resolve an operator by their Ringover user_id (the call agent id). */
export async function resolveColaboradorByRingoverId(
  ringoverUserId: string,
): Promise<Colaborador | null> {
  const [row] = await db
    .select()
    .from(colaboradoresTable)
    .where(eq(colaboradoresTable.ringoverUserId, ringoverUserId))
    .limit(1);
  return row ?? null;
}

export interface SaveChecklistInput {
  conversationId: number;
  colaboradorId: number | null;
  faseDetectada: Fase;
  results: ChecklistPointResult[];
}

/**
 * Persist per-point results for a conversation and stamp the conversation with
 * its operator + detected phase. Idempotent: upserts on the unique
 * (conversation, item) pair so re-analysis overwrites in place rather than
 * duplicating.
 */
export async function saveChecklistResults(input: SaveChecklistInput): Promise<void> {
  const { conversationId, colaboradorId, faseDetectada, results } = input;

  for (const r of results) {
    await db
      .insert(callChecklistResultsTable)
      .values({
        conversationId,
        itemId: r.itemId,
        colaboradorId,
        estado: r.estado,
        evidencia: r.evidencia || null,
      })
      .onConflictDoUpdate({
        target: [callChecklistResultsTable.conversationId, callChecklistResultsTable.itemId],
        set: { colaboradorId, estado: r.estado, evidencia: r.evidencia || null },
      });
  }

  await db
    .update(conversationsTable)
    .set({ colaboradorId, faseDetectada })
    .where(eq(conversationsTable.id, conversationId));
}

export interface LoadEvaluationsFilter {
  /** Inclusive YYYY-MM-DD bounds, matched against conversations.run_date. */
  de: string;
  ate: string;
  /** Optional operator filter. */
  colaboradorId?: number;
}

/**
 * Load per-point evaluations over a period (and optional operator), shaped for
 * {@link computeAllCategoryStats}. Joins results → items (for categoryId) →
 * conversations (for the date window).
 */
export async function loadPointEvaluations(
  filter: LoadEvaluationsFilter,
): Promise<PointEvaluation[]> {
  const conds: SQL[] = [
    gte(conversationsTable.runDate, filter.de),
    lte(conversationsTable.runDate, filter.ate),
  ];
  if (filter.colaboradorId != null) {
    conds.push(eq(callChecklistResultsTable.colaboradorId, filter.colaboradorId));
  }

  const rows = await db
    .select({
      conversationId: callChecklistResultsTable.conversationId,
      colaboradorId: callChecklistResultsTable.colaboradorId,
      categoryId: checklistItemsTable.categoryId,
      itemId: callChecklistResultsTable.itemId,
      estado: callChecklistResultsTable.estado,
    })
    .from(callChecklistResultsTable)
    .innerJoin(checklistItemsTable, eq(callChecklistResultsTable.itemId, checklistItemsTable.id))
    .innerJoin(
      conversationsTable,
      eq(callChecklistResultsTable.conversationId, conversationsTable.id),
    )
    .where(and(...conds));

  // `estado` is a text enum column → already the Estado union at the type level.
  return rows.map((r) => ({
    conversationId: r.conversationId,
    colaboradorId: r.colaboradorId,
    categoryId: r.categoryId,
    itemId: r.itemId,
    estado: r.estado as Estado,
  }));
}
