import { estimateCost, type CostBreakdown } from "./cost.js";
import {
  chatCompletionResponseSchema,
  type ChatCompletionResponse,
  type ChatMessage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_RETRIES = 4;
const RETRY_BASE_MS = 1000;

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Optional headers OpenRouter encourages (HTTP-Referer, X-Title for analytics). */
  appReferer?: string;
  appTitle?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Force a JSON object response when the model supports it. */
  response_format?: { type: "json_object" };
  /** OpenRouter-specific preference list (anthropic, openai, etc.). */
  provider?: { order?: string[]; allow_fallbacks?: boolean };
  metadata?: Record<string, string>;
}

export interface ChatCompletionResult {
  raw: ChatCompletionResponse;
  text: string;
  cost: CostBreakdown;
}

export class OpenRouterError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/**
 * OpenRouter chat-completions client. Retries on 429 and 5xx with exponential
 * backoff, honouring `Retry-After` when present. Cost is estimated from the
 * `usage` block per {@link estimateCost}.
 */
export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxRetries: number;

  constructor(opts: OpenRouterClientOptions) {
    if (!opts.apiKey) throw new Error("OpenRouterClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.extraHeaders = {};
    if (opts.appReferer) this.extraHeaders["HTTP-Referer"] = opts.appReferer;
    if (opts.appTitle) this.extraHeaders["X-Title"] = opts.appTitle;
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify(req);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method: "POST", headers, body });
        if (res.ok) {
          const json = (await res.json()) as unknown;
          const parsed = chatCompletionResponseSchema.parse(json);
          const choice = parsed.choices[0];
          const text = choice.message.content ?? "";
          const cost = estimateCost(req.model, parsed.usage);
          return { raw: parsed, text, cost };
        }
        if (!isRetryable(res.status) || attempt === this.maxRetries) {
          const errBody = await safeText(res);
          throw new OpenRouterError(
            res.status,
            errBody,
            `OpenRouter chat completion failed (${res.status})`,
          );
        }
        const wait = computeBackoff(attempt, res.headers.get("retry-after"));
        await sleep(wait);
      } catch (err) {
        lastError = err;
        if (err instanceof OpenRouterError && !isRetryable(err.status)) throw err;
        if (attempt === this.maxRetries) throw err;
        await sleep(computeBackoff(attempt, null));
      }
    }
    throw lastError ?? new Error("OpenRouter chat completion failed after retries");
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function computeBackoff(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const sec = Number(retryAfterHeader);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  }
  return RETRY_BASE_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
