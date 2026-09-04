import {
  OpenRouterClient,
  type ChatMessage,
  type CostBreakdown,
} from "@workspace/openrouter";
import type { GroupedConversation } from "../grouping/conversations.js";
import {
  checklistAnalysisSchema,
  type ChecklistAnalysis,
  type ChecklistPointResult,
} from "./checklist-schema.js";
import {
  buildChecklistSystemPrompt,
  buildChecklistUserMessage,
  type ChecklistItemForPrompt,
} from "./checklist-prompt.js";

export interface AnalyzeChecklistOptions {
  client: OpenRouterClient;
  model?: string;
  cacheSystemPrompt?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Only used by a direct caller — `analyze-day` always passes the configured
 * model. Kept in step with the env default so a direct call does not quietly
 * run two generations behind.
 */
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const MAX_TOKENS_RETRY = 6000;

export type ChecklistOutcome =
  | { ok: true; analysis: ChecklistAnalysis; cost: CostBreakdown; rawText: string }
  | { ok: false; error: string; rawText: string; cost: CostBreakdown };

/**
 * Reconcile the raw LLM results against the applicable item ids:
 *  - drop results for ids that aren't in the applicable set (hallucinated ids),
 *  - fill any applicable item the model omitted with `indeterminado`,
 *  - de-duplicate (first occurrence wins).
 * Guarantees exactly one result per applicable item.
 */
export function reconcileChecklistResults(
  applicable: ChecklistItemForPrompt[],
  raw: ChecklistPointResult[],
): ChecklistPointResult[] {
  const applicableIds = new Set(applicable.map((i) => i.id));
  const seen = new Map<number, ChecklistPointResult>();
  for (const r of raw) {
    if (!applicableIds.has(r.itemId)) continue;
    if (seen.has(r.itemId)) continue;
    seen.set(r.itemId, r);
  }
  return applicable.map(
    (item) =>
      seen.get(item.id) ?? { itemId: item.id, estado: "indeterminado", evidencia: "" },
  );
}

async function callOnce(
  conv: GroupedConversation,
  items: ChecklistItemForPrompt[],
  opts: AnalyzeChecklistOptions,
  maxTokensOverride?: number,
): Promise<{ result: Awaited<ReturnType<OpenRouterClient["chatCompletion"]>>; cleaned: string }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;
  const systemText = buildChecklistSystemPrompt();
  const userText = buildChecklistUserMessage(conv, items);

  const systemMessage: ChatMessage = cache
    ? {
        role: "system",
        content: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      }
    : { role: "system", content: systemText };

  const result = await opts.client.chatCompletion({
    model,
    temperature: opts.temperature ?? 0.1,
    max_tokens: maxTokensOverride ?? opts.maxTokens ?? 4096,
    response_format: { type: "json_object" },
    messages: [systemMessage, { role: "user", content: userText }],
  });

  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  return { result, cleaned };
}

function looksLikeTruncation(raw: string): boolean {
  const trimmed = raw.trim();
  return !(trimmed.endsWith("}") || trimmed.endsWith("]"));
}

/**
 * Evaluate a conversation against the supplied checklist items. Output is
 * validated and then reconciled so every applicable item has exactly one
 * result. On invalid/truncated JSON it retries once with a larger budget; on
 * persistent failure it returns `ok: false` so the caller can record the error
 * and continue the run (mirrors {@link analyzeConversation}).
 */
export async function analyzeChecklist(
  conv: GroupedConversation,
  items: ChecklistItemForPrompt[],
  opts: AnalyzeChecklistOptions,
): Promise<ChecklistOutcome> {
  let { result, cleaned } = await callOnce(conv, items, opts);
  let totalCost = result.cost;

  let parsed: unknown;
  let parseError: Error | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parseError = err as Error;
  }

  if (parseError !== null && looksLikeTruncation(cleaned)) {
    const retry = await callOnce(conv, items, opts, MAX_TOKENS_RETRY);
    totalCost = {
      ...retry.result.cost,
      costUsd: totalCost.costUsd + retry.result.cost.costUsd,
      inputTokens: totalCost.inputTokens + retry.result.cost.inputTokens,
      outputTokens: totalCost.outputTokens + retry.result.cost.outputTokens,
    };
    cleaned = retry.cleaned;
    parseError = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      parseError = err as Error;
    }
  }

  if (parseError !== null) {
    return {
      ok: false,
      error: `Resposta do LLM não é JSON válido: ${parseError.message}. Raw: ${cleaned.slice(0, 300)}`,
      rawText: result.text,
      cost: totalCost,
    };
  }

  const validated = checklistAnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Resposta falhou validação Zod: ${validated.error.message}`,
      rawText: result.text,
      cost: totalCost,
    };
  }

  const reconciled = reconcileChecklistResults(items, validated.data.resultados);

  return {
    ok: true,
    analysis: { faseDetectada: validated.data.faseDetectada, resultados: reconciled },
    cost: totalCost,
    rawText: result.text,
  };
}
