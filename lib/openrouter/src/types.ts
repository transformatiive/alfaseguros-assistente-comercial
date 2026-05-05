import { z } from "zod";

/** A content block — supports OpenRouter's `cache_control` extension on text blocks. */
export const messageContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  cache_control: z
    .object({ type: z.literal("ephemeral") })
    .optional(),
});

export type MessageContentBlock = z.infer<typeof messageContentBlockSchema>;

export const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(messageContentBlockSchema)]),
});

export type ChatMessage = z.infer<typeof messageSchema>;

export const usageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

export type Usage = z.infer<typeof usageSchema>;

export const chatCompletionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().optional(),
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          role: z.string(),
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: usageSchema.optional(),
});

export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

/** Per-million-token prices for the models we use. Keep in sync with OpenRouter pricing. */
export interface ModelPricing {
  /** USD per 1M input tokens (uncached). */
  inputUsdPerMillion: number;
  /** USD per 1M output tokens. */
  outputUsdPerMillion: number;
  /** USD per 1M cache-write input tokens (Anthropic charges 1.25x base). */
  cacheWriteUsdPerMillion: number;
  /** USD per 1M cache-read input tokens (Anthropic charges 0.1x base). */
  cacheReadUsdPerMillion: number;
}

/**
 * Pricing snapshot for the models we touch. As of late 2025; verify against
 * https://openrouter.ai/models if costs look off.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4": {
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheWriteUsdPerMillion: 3.75,
    cacheReadUsdPerMillion: 0.3,
  },
  "anthropic/claude-3.5-haiku": {
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
    cacheWriteUsdPerMillion: 1.0,
    cacheReadUsdPerMillion: 0.08,
  },
  "anthropic/claude-opus-4": {
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cacheWriteUsdPerMillion: 18.75,
    cacheReadUsdPerMillion: 1.5,
  },
};
