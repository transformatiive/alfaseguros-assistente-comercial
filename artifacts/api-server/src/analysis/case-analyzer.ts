import {
  OpenRouterClient,
  type ChatMessage,
  type CostBreakdown,
} from "@workspace/openrouter";
import type { LinkedCase } from "../cases/linker.js";
import {
  conversationAnalysisSchema,
  type ConversationAnalysis,
} from "./schema.js";
import { buildSystemPrompt } from "./prompts.js";

export interface AnalyzeCaseOptions {
  client: OpenRouterClient;
  model?: string;
  cacheSystemPrompt?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export type CaseAnalysisOutcome =
  | { ok: true; analysis: ConversationAnalysis; cost: CostBreakdown; rawText: string }
  | { ok: false; error: string; rawText: string; cost: CostBreakdown };

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

/**
 * Build the multi-channel timeline message per HANDOVER §4. Walks the case's
 * legs in chronological order and formats each by kind (call / ticket event /
 * ticket comment).
 */
export function buildCaseUserMessage(c: LinkedCase): string {
  const header = [
    `# Conversa multi-canal — Cliente ${c.customerPhone ?? `(fingerprint ${c.phoneFingerprint})`}`,
    c.customerName ? `Nome: ${c.customerName}` : null,
    c.productName ? `Produto: ${c.productName}` : null,
    c.primaryAgentName ? `Operador principal: ${c.primaryAgentName}` : null,
    `Período: ${c.firstActivityAt ?? "?"} → ${c.lastActivityAt ?? "?"}`,
    `Total de legs: ${c.legs.length} (chamadas + tickets + comentários)`,
  ]
    .filter((s): s is string => s != null)
    .join("\n");

  const legBlocks = c.legs.map((leg, idx) => {
    const lines = [
      `## ${idx + 1}. ${formatTime(leg.at)} — ${leg.label}${leg.agentName ? ` — ${leg.agentName}` : ""}`,
    ];
    if (leg.detail) lines.push("", leg.detail);
    return lines.join("\n");
  });

  return [header, "", ...legBlocks].join("\n");
}

export async function analyzeCase(
  c: LinkedCase,
  opts: AnalyzeCaseOptions,
): Promise<CaseAnalysisOutcome> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;
  const systemText = buildSystemPrompt();
  const userText = buildCaseUserMessage(c);

  const systemMessage: ChatMessage = cache
    ? {
        role: "system",
        content: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      }
    : { role: "system", content: systemText };

  const result = await opts.client.chatCompletion({
    model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 12000,
    response_format: { type: "json_object" },
    messages: [systemMessage, { role: "user", content: userText }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (err) {
    return {
      ok: false,
      error: `Resposta do LLM não é JSON válido: ${(err as Error).message}`,
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
  return { ok: true, analysis: validated.data, cost: result.cost, rawText: result.text };
}
