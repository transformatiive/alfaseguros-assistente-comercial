import {
  OpenRouterClient,
  type ChatMessage,
  type CostBreakdown,
} from "@workspace/openrouter";
import type { GroupedConversation } from "../grouping/conversations.js";
import {
  conversationAnalysisSchema,
  type ConversationAnalysis,
} from "./schema.js";
import {
  buildConversationUserMessage,
  buildSystemPrompt,
  type RelatedTicketForPrompt,
} from "./prompts.js";

export interface AnalyzeOptions {
  client: OpenRouterClient;
  model?: string;
  /** Apply cache_control: ephemeral on the system prompt (cost-saver across batch). Default true. */
  cacheSystemPrompt?: boolean;
  /** Override temperature; defaults to 0.2 — analytical, low variance. */
  temperature?: number;
  /**
   * Maximum tokens for the response.
   * Default 4096 — multi-leg conversations produce JSON well over 2000 tokens.
   * On truncation the call is retried once with MAX_TOKENS_RETRY.
   */
  maxTokens?: number;
  /**
   * Zoho Desk tickets (with comment threads) associated with this conversation's
   * phone number. When provided they are appended to the user message so the
   * LLM can build a richer, temporally-coherent narrative.
   */
  relatedTickets?: RelatedTicketForPrompt[];
}

/** Token ceiling used on the automatic retry when a truncated JSON is detected. */
const MAX_TOKENS_RETRY = 6000;

export type AnalysisOutcome =
  | { ok: true; analysis: ConversationAnalysis; cost: CostBreakdown; rawText: string }
  | { ok: false; error: string; rawText: string; cost: CostBreakdown };

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

/**
 * Analyze a single grouped conversation. Output is validated against
 * {@link conversationAnalysisSchema}; on failure (invalid JSON or schema
 * mismatch) the result is `ok: false` with the raw text, so the caller can
 * persist an `analysisError` row and continue the run.
 */
/**
 * Single LLM call for one conversation. Returns ok/fail without retrying.
 */
async function callOnce(
  conv: GroupedConversation,
  opts: AnalyzeOptions,
  maxTokensOverride?: number,
): Promise<{ result: Awaited<ReturnType<OpenRouterClient["chatCompletion"]>>; cleaned: string }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;
  const systemText = buildSystemPrompt();
  const userText = buildConversationUserMessage(conv, opts.relatedTickets);

  const systemMessage: ChatMessage = cache
    ? {
        role: "system",
        content: [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral" },
          },
        ],
      }
    : { role: "system", content: systemText };

  const result = await opts.client.chatCompletion({
    model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: maxTokensOverride ?? opts.maxTokens ?? 4096,
    response_format: { type: "json_object" },
    messages: [systemMessage, { role: "user", content: userText }],
  });

  // Strip markdown code-fence wrappers some models add even with response_format=json_object
  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  return { result, cleaned };
}

function looksLikeTruncation(raw: string): boolean {
  const trimmed = raw.trim();
  // A complete JSON object ends with } or ]; truncation leaves it open
  return !(trimmed.endsWith("}") || trimmed.endsWith("]"));
}

/**
 * Analyze a single grouped conversation. Output is validated against
 * {@link conversationAnalysisSchema}; on failure (invalid JSON or schema
 * mismatch) the result is `ok: false` with the raw text, so the caller can
 * persist an `analysisError` row and continue the run.
 *
 * If the response looks truncated (JSON parse error + open-ended raw text)
 * the call is retried **once** with {@link MAX_TOKENS_RETRY} tokens.
 */
export async function analyzeConversation(
  conv: GroupedConversation,
  opts: AnalyzeOptions,
): Promise<AnalysisOutcome> {
  let { result, cleaned } = await callOnce(conv, opts);
  let totalCost = result.cost;

  // --- attempt to parse; retry if truncated ---
  let parsed: unknown;
  let parseError: Error | null = null;

  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parseError = err as Error;
  }

  if (parseError !== null && looksLikeTruncation(cleaned)) {
    // Retry with a larger token budget
    const retry = await callOnce(conv, opts, MAX_TOKENS_RETRY);
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

  const validated = conversationAnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Resposta falhou validação Zod: ${validated.error.message}`,
      rawText: result.text,
      cost: totalCost,
    };
  }

  return {
    ok: true,
    analysis: validated.data,
    cost: totalCost,
    rawText: result.text,
  };
}
