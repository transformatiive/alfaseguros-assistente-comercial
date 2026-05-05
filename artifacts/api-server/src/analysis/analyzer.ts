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
} from "./prompts.js";

export interface AnalyzeOptions {
  client: OpenRouterClient;
  model?: string;
  /** Apply cache_control: ephemeral on the system prompt (cost-saver across batch). Default true. */
  cacheSystemPrompt?: boolean;
  /** Override temperature; defaults to 0.2 — analytical, low variance. */
  temperature?: number;
  /** Maximum tokens for the response. Default 2000 (the JSON is small). */
  maxTokens?: number;
}

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
export async function analyzeConversation(
  conv: GroupedConversation,
  opts: AnalyzeOptions,
): Promise<AnalysisOutcome> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;
  const systemText = buildSystemPrompt();
  const userText = buildConversationUserMessage(conv);

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
    max_tokens: opts.maxTokens ?? 2000,
    response_format: { type: "json_object" },
    messages: [systemMessage, { role: "user", content: userText }],
  });

  // Strip markdown code-fence wrappers some models add even with response_format=json_object
  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      error: `Resposta do LLM não é JSON válido: ${(err as Error).message}. Raw: ${cleaned.slice(0, 300)}`,
      rawText: result.text,
      cost: result.cost,
    };
  }

  const validated = conversationAnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Resposta falhou validação Zod: ${validated.error.message}`,
      rawText: result.text,
      cost: result.cost,
    };
  }

  return {
    ok: true,
    analysis: validated.data,
    cost: result.cost,
    rawText: result.text,
  };
}
