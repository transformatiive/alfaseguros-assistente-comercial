import type { OpenRouterClient } from "@workspace/openrouter";
import type { GroupedConversation, ConversationLeg } from "../grouping/conversations.js";
import { analyzeChecklist } from "../analysis/checklist-analyzer.js";
import {
  loadChecklistForPrompt,
  resolveColaboradorByRingoverId,
  hasChecklistResults,
  saveChecklistResults,
  loadConversationsForDate,
  type ConversationRow,
} from "../storage/repo.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { logger } from "../lib/logger.js";

export interface VidaChecklistPassOptions {
  groups: GroupedConversation[];
  rowIdByPhone: Map<string, number>;
  client: OpenRouterClient;
  model: string;
  concurrency: number;
  force: boolean;
}

export interface VidaChecklistPassResult {
  analyzed: number;
  skipped: number;
  costUsd: number;
}

/**
 * Additive, isolated checklist pass for the Vida team (MVP = Fase 1).
 *
 * Runs ONLY for conversations whose agent resolves to a Vida operator, and
 * writes ONLY to the V2 checklist tables — the 360 narrative pipeline and the
 * existing emails are untouched. Cache-aware: a conversation already evaluated
 * is skipped unless `force`. Designed to be wrapped in try/catch by the caller
 * so a failure here never breaks the main run.
 */
export async function runVidaChecklistPass(
  opts: VidaChecklistPassOptions,
): Promise<VidaChecklistPassResult> {
  const items = await loadChecklistForPrompt("vida", "primeiro_contacto");
  if (items.length === 0) {
    logger.info("Vida checklist pass skipped — no active Fase 1 checklist seeded");
    return { analyzed: 0, skipped: 0, costUsd: 0 };
  }

  let analyzed = 0;
  let skipped = 0;
  let costUsd = 0;

  await mapWithConcurrency(opts.groups, opts.concurrency, async (g) => {
    if (!g.agentId) return;

    const colaborador = await resolveColaboradorByRingoverId(g.agentId);
    if (!colaborador || colaborador.equipa !== "vida") return;

    const rowId = opts.rowIdByPhone.get(g.customerPhone);
    if (rowId == null) return;

    if (!opts.force && (await hasChecklistResults(rowId))) {
      skipped += 1;
      return;
    }

    const outcome = await analyzeChecklist(g, items, { client: opts.client, model: opts.model });
    if (!outcome.ok) {
      logger.warn(
        { conversationId: rowId, agentId: g.agentId, error: outcome.error },
        "Vida checklist analysis failed",
      );
      return;
    }

    costUsd += outcome.cost.costUsd;
    await saveChecklistResults({
      conversationId: rowId,
      colaboradorId: colaborador.id,
      faseDetectada: outcome.analysis.faseDetectada,
      results: outcome.analysis.resultados,
    });
    analyzed += 1;
  });

  logger.info({ analyzed, skipped, costUsd }, "Vida checklist pass complete");
  return { analyzed, skipped, costUsd };
}

/** Reconstruct a GroupedConversation from a stored conversation row. */
function rowToGroupedConversation(row: ConversationRow): GroupedConversation {
  const rawLegs = Array.isArray(row.legsJson) ? (row.legsJson as Array<Record<string, unknown>>) : [];
  const legs: ConversationLeg[] = rawLegs.map((l) => ({
    callId: String(l.callId ?? ""),
    agentId: row.agentId,
    agentName: (typeof l.agentName === "string" ? l.agentName : null) ?? row.agentName,
    direction: typeof l.direction === "string" ? l.direction : null,
    startTime: typeof l.startTime === "string" ? l.startTime : null,
    durationSec: typeof l.durationSec === "number" ? l.durationSec : 0,
    ringoverSummary: typeof l.ringoverSummary === "string" ? l.ringoverSummary : "",
    recordingUrl: null,
  }));
  return {
    customerPhone: row.customerPhone,
    callIds: row.callIds.length > 0 ? row.callIds : legs.map((l) => l.callId),
    agentId: row.agentId,
    agentName: row.agentName,
    agentsInvolved: row.agentId ? [{ id: row.agentId, name: row.agentName ?? "" }] : [],
    durationSec: row.durationSec ?? 0,
    recordingUrls: row.recordingUrls,
    legCount: legs.length,
    isMultiLeg: legs.length > 1,
    startTime: legs[0]?.startTime ?? null,
    legs,
  };
}

/**
 * Backfill the Vida checklist for a date using conversations ALREADY stored
 * (reuses the persisted Ringover summaries — no narrative re-analysis). Lets us
 * populate checklist results cheaply after seeding, without a full force run.
 */
export async function backfillVidaChecklistForDate(opts: {
  date: string;
  client: OpenRouterClient;
  model: string;
  concurrency: number;
  force: boolean;
}): Promise<VidaChecklistPassResult> {
  const rows = await loadConversationsForDate(opts.date);
  const groups = rows.map(rowToGroupedConversation);
  const rowIdByPhone = new Map<string, number>();
  for (const r of rows) rowIdByPhone.set(r.customerPhone, r.id);

  return runVidaChecklistPass({
    groups,
    rowIdByPhone,
    client: opts.client,
    model: opts.model,
    concurrency: opts.concurrency,
    force: opts.force,
  });
}
