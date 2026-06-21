import { and, eq, gte, lte, or, sql, isNull, type SQL } from "drizzle-orm";
import {
  db,
  conversationsTable,
  colaboradoresTable,
  checklistCategoriesTable,
  checklistItemsTable,
  callChecklistResultsTable,
  alertLogTable,
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
type Equipa = "360" | "vida" | "admin" | "mkt" | "sinistros";

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

/** Item label set for dashboards/emails: short tag + full criterion + coaching tip. */
export interface ChecklistItemLabel {
  id: number;
  validacao: string;
  texto: string;
  mensagemMelhoria: string;
}

/**
 * Load id → { validacao, texto, mensagemMelhoria } for a scope/phase. Used to
 * surface the *measured criterion* (and how to improve it) in the dashboard and
 * the coordinator/coaching emails — not just the cryptic short tag.
 */
export async function loadChecklistLabels(
  escopo: string,
  fase: Fase,
): Promise<ChecklistItemLabel[]> {
  return db
    .select({
      id: checklistItemsTable.id,
      validacao: checklistItemsTable.validacao,
      texto: checklistItemsTable.texto,
      mensagemMelhoria: checklistItemsTable.mensagemMelhoria,
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
    );
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

/** True if a conversation already has any checklist result (cache guard). */
export async function hasChecklistResults(conversationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: callChecklistResultsTable.id })
    .from(callChecklistResultsTable)
    .where(eq(callChecklistResultsTable.conversationId, conversationId))
    .limit(1);
  return row != null;
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

export interface CategoriaMeta {
  id: number;
  nome: string;
  fase: string;
  obrigatoria: boolean;
  ordem: number;
}

export interface ConversationRow {
  id: number;
  customerPhone: string;
  agentId: string | null;
  agentName: string | null;
  durationSec: number | null;
  legsJson: unknown;
  callIds: string[];
  recordingUrls: string[];
}

/** All conversations for a run date (for the Vida checklist backfill). */
export async function loadConversationsForDate(date: string): Promise<ConversationRow[]> {
  return db
    .select({
      id: conversationsTable.id,
      customerPhone: conversationsTable.customerPhone,
      agentId: conversationsTable.agentId,
      agentName: conversationsTable.agentName,
      durationSec: conversationsTable.durationSec,
      legsJson: conversationsTable.legsJson,
      callIds: conversationsTable.callIds,
      recordingUrls: conversationsTable.recordingUrls,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.runDate, date));
}

/** Number of conversations on a date whose agent is a Vida operator. */
export async function countVidaConversationsForDate(date: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversationsTable)
    .innerJoin(colaboradoresTable, eq(colaboradoresTable.ringoverUserId, conversationsTable.agentId))
    .where(and(eq(conversationsTable.runDate, date), eq(colaboradoresTable.equipa, "vida")));
  return row?.n ?? 0;
}

export interface ChecklistDistribution {
  total: number;
  chamadas: number;
  porEstado: Array<{ estado: string; n: number }>;
}

/** Global distribution of checklist result states (diagnostics). */
export async function checklistDistribution(): Promise<ChecklistDistribution> {
  const [tot] = await db
    .select({
      total: sql<number>`count(*)::int`,
      chamadas: sql<number>`count(distinct ${callChecklistResultsTable.conversationId})::int`,
    })
    .from(callChecklistResultsTable);
  const porEstado = await db
    .select({ estado: callChecklistResultsTable.estado, n: sql<number>`count(*)::int` })
    .from(callChecklistResultsTable)
    .groupBy(callChecklistResultsTable.estado);
  return { total: tot?.total ?? 0, chamadas: tot?.chamadas ?? 0, porEstado };
}

/** Active operators of a team. */
export async function loadColaboradores(equipa: Equipa): Promise<Colaborador[]> {
  return db
    .select()
    .from(colaboradoresTable)
    .where(and(eq(colaboradoresTable.equipa, equipa), eq(colaboradoresTable.ativo, true)))
    .orderBy(colaboradoresTable.nome);
}

export interface ConversationBasic {
  id: number;
  customerPhone: string;
  agentName: string | null;
  runDate: string;
  faseDetectada: string | null;
  colaboradorId: number | null;
  analysisJson: unknown;
}

/** Minimal conversation row for the drill-down detail. Null if absent. */
export async function loadConversationBasic(id: number): Promise<ConversationBasic | null> {
  const [row] = await db
    .select({
      id: conversationsTable.id,
      customerPhone: conversationsTable.customerPhone,
      agentName: conversationsTable.agentName,
      runDate: conversationsTable.runDate,
      faseDetectada: conversationsTable.faseDetectada,
      colaboradorId: conversationsTable.colaboradorId,
      analysisJson: conversationsTable.analysisJson,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  return row ?? null;
}

/** Category metadata for a scope (to enrich the aggregated stats with names). */
export async function loadCategorias(escopo: string, fase?: Fase): Promise<CategoriaMeta[]> {
  const conds: SQL[] = [
    eq(checklistCategoriesTable.escopo, escopo),
    eq(checklistCategoriesTable.ativo, true),
  ];
  if (fase) conds.push(eq(checklistCategoriesTable.fase, fase));
  return db
    .select({
      id: checklistCategoriesTable.id,
      nome: checklistCategoriesTable.nome,
      fase: checklistCategoriesTable.fase,
      obrigatoria: checklistCategoriesTable.obrigatoria,
      ordem: checklistCategoriesTable.ordem,
    })
    .from(checklistCategoriesTable)
    .where(and(...conds))
    .orderBy(checklistCategoriesTable.ordem);
}

export interface ConversationChecklistRow {
  itemId: number;
  categoryId: number;
  categoria: string;
  validacao: string;
  texto: string;
  estado: Estado;
  evidencia: string | null;
}

/** All checklist results for one conversation, with item + category labels. */
export async function loadChecklistResultsForConversation(
  conversationId: number,
): Promise<ConversationChecklistRow[]> {
  const rows = await db
    .select({
      itemId: callChecklistResultsTable.itemId,
      categoryId: checklistItemsTable.categoryId,
      categoria: checklistCategoriesTable.nome,
      validacao: checklistItemsTable.validacao,
      texto: checklistItemsTable.texto,
      estado: callChecklistResultsTable.estado,
      evidencia: callChecklistResultsTable.evidencia,
      ordemCat: checklistCategoriesTable.ordem,
      ordemItem: checklistItemsTable.ordem,
    })
    .from(callChecklistResultsTable)
    .innerJoin(checklistItemsTable, eq(callChecklistResultsTable.itemId, checklistItemsTable.id))
    .innerJoin(
      checklistCategoriesTable,
      eq(checklistItemsTable.categoryId, checklistCategoriesTable.id),
    )
    .where(eq(callChecklistResultsTable.conversationId, conversationId))
    .orderBy(checklistCategoriesTable.ordem, checklistItemsTable.ordem);

  return rows.map((r) => ({
    itemId: r.itemId,
    categoryId: r.categoryId,
    categoria: r.categoria,
    validacao: r.validacao,
    texto: r.texto,
    estado: r.estado as Estado,
    evidencia: r.evidencia,
  }));
}

export interface EligibleAlertRow {
  conversationId: number;
  colaboradorId: number | null;
  colaboradorNome: string | null;
  colaboradorEmail: string | null;
  itemId: number;
  categoria: string;
  validacao: string;
  texto: string;
  mensagemMelhoria: string;
  compliance: boolean;
  categoriaObrigatoria: boolean;
}

/**
 * Eligible non-compliances for a given day: estado = nao_cumprido AND
 * (category.obrigatoria OR item.compliance). Joined with the operator so the
 * n8n digest has names/emails. Drives GET /api/alertas-dia.
 */
export async function loadEligibleAlerts(
  data: string,
  opts: { incluirEnviados?: boolean } = {},
): Promise<EligibleAlertRow[]> {
  const rows = await db
    .select({
      conversationId: callChecklistResultsTable.conversationId,
      colaboradorId: callChecklistResultsTable.colaboradorId,
      colaboradorNome: colaboradoresTable.nome,
      colaboradorEmail: colaboradoresTable.email,
      itemId: callChecklistResultsTable.itemId,
      categoria: checklistCategoriesTable.nome,
      validacao: checklistItemsTable.validacao,
      texto: checklistItemsTable.texto,
      mensagemMelhoria: checklistItemsTable.mensagemMelhoria,
      compliance: checklistItemsTable.compliance,
      categoriaObrigatoria: checklistCategoriesTable.obrigatoria,
    })
    .from(callChecklistResultsTable)
    .innerJoin(checklistItemsTable, eq(callChecklistResultsTable.itemId, checklistItemsTable.id))
    .innerJoin(
      checklistCategoriesTable,
      eq(checklistItemsTable.categoryId, checklistCategoriesTable.id),
    )
    .innerJoin(conversationsTable, eq(callChecklistResultsTable.conversationId, conversationsTable.id))
    .leftJoin(colaboradoresTable, eq(callChecklistResultsTable.colaboradorId, colaboradoresTable.id))
    // Idempotency: exclude (conversation, item) pairs already recorded as sent.
    .leftJoin(
      alertLogTable,
      and(
        eq(alertLogTable.conversationId, callChecklistResultsTable.conversationId),
        eq(alertLogTable.itemId, callChecklistResultsTable.itemId),
      ),
    )
    .where(
      and(
        eq(conversationsTable.runDate, data),
        eq(callChecklistResultsTable.estado, "nao_cumprido"),
        // Eligible = obligatory category (non-conditional points only) OR a
        // compliance point (always). Conditional points never alert via the
        // category, only as compliance.
        or(
          and(eq(checklistCategoriesTable.obrigatoria, true), eq(checklistItemsTable.condicional, false)),
          eq(checklistItemsTable.compliance, true),
        ),
        // For previews/demos, include already-sent pairs.
        opts.incluirEnviados ? undefined : isNull(alertLogTable.id),
      ),
    );

  return rows;
}

/**
 * Mark the day's eligible alerts as sent (idempotency log). Inserts one
 * alert_log row per eligible (conversation, item); the unique (conversation,
 * item) index + ON CONFLICT DO NOTHING make repeated calls and force
 * re-analysis safe — a sent alert is never re-sent. Returns rows newly marked.
 */
export async function confirmarAlertas(data: string): Promise<number> {
  const pendentes = await loadEligibleAlerts(data); // already excludes sent
  if (pendentes.length === 0) return 0;
  await db
    .insert(alertLogTable)
    .values(
      pendentes.map((r) => ({
        conversationId: r.conversationId,
        itemId: r.itemId,
        colaboradorId: r.colaboradorId,
        canal: "email" as const,
        estadoEnvio: "enviado" as const,
        enviadoEm: new Date(),
      })),
    )
    .onConflictDoNothing({
      target: [alertLogTable.conversationId, alertLogTable.itemId],
    });
  return pendentes.length;
}
