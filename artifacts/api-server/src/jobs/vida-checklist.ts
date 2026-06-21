import type { OpenRouterClient } from "@workspace/openrouter";
import type { GroupedConversation } from "../grouping/conversations.js";
import { analyzeChecklist } from "../analysis/checklist-analyzer.js";
import {
  loadChecklistForPrompt,
  resolveColaboradorByRingoverId,
  hasChecklistResults,
  saveChecklistResults,
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
