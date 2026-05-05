import { MODEL_PRICING, type Usage } from "./types.js";

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * Estimate USD cost from an OpenRouter `usage` block. Splits cached vs
 * uncached input tokens because Anthropic charges those at very different
 * rates (cache reads ~10% of base, cache writes ~125%). Unknown models cost 0.
 */
export function estimateCost(model: string, usage: Usage | undefined): CostBreakdown {
  const pricing = MODEL_PRICING[model];
  const total = usage?.total_tokens ?? 0;
  const promptTotal = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? Math.max(total - promptTotal, 0);
  const cacheRead = usage?.cache_read_input_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const uncachedInput = Math.max(promptTotal - cacheRead - cacheWrite, 0);

  const breakdown: CostBreakdown = {
    inputTokens: uncachedInput,
    outputTokens: completion,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: 0,
  };

  if (!pricing) return breakdown;

  breakdown.costUsd =
    (uncachedInput * pricing.inputUsdPerMillion) / 1_000_000 +
    (completion * pricing.outputUsdPerMillion) / 1_000_000 +
    (cacheRead * pricing.cacheReadUsdPerMillion) / 1_000_000 +
    (cacheWrite * pricing.cacheWriteUsdPerMillion) / 1_000_000;

  return breakdown;
}
