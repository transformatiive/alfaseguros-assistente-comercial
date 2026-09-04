import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  SESSION_SECRET: z.string().default("change-me-in-production"),
  RINGOVER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /**
   * OpenRouter model id for every analysis call.
   *
   * The default is a real id, checked against OpenRouter's catalogue: the
   * previous one (`claude-sonnet-4-6`, hyphenated) does not exist there — they
   * use a dot — so if the platform variable had ever been missing, every
   * analysis would have failed on a 400 that named a model nobody could find.
   */
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  /**
   * The model for the Vida checklist pass, which is a different job from the
   * rest of the pipeline and deserves a different model.
   *
   * Everything else in the run writes prose a person reads and acts on — a
   * 1-to-5 quality score, the severity of a procedural deviation, the feedback
   * a supervisor gives an agent. The checklist does not: it walks a fixed list
   * of items at temperature 0.1 and says whether each was covered. That is
   * extraction, not judgement, and it is what Haiku is for — at half the
   * price of Sonnet on input and output alike.
   *
   * Separate from `OPENROUTER_MODEL` on purpose: raising the main model must
   * not silently raise this one's bill, and lowering this one must not touch
   * the analysis anybody reads.
   */
  OPENROUTER_MODEL_CHECKLIST: z.string().default("anthropic/claude-haiku-4.5"),
  CRON_WEBHOOK_SECRET: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ZOHO_DESK_CLIENT_ID: z.string().optional(),
  ZOHO_DESK_CLIENT_SECRET: z.string().optional(),
  ZOHO_DESK_REFRESH_TOKEN: z.string().optional(),
  ZOHO_DESK_ORG_ID: z.string().optional(),
  /** Zoho Desk department for the /leads dashboard (Não Vida). Defaults to the known id. */
  ZOHO_DESK_NAOVIDA_DEPARTMENT_ID: z.string().default("367662000000006907"),
  /** Bearer token that n8n uses to authenticate with /api/followups/* endpoints */
  FOLLOWUP_API_TOKEN: z.string().optional(),
  /** JSON object mapping Ringover numeric agent_id to email: {"23275677":"ana@alfa.pt"} */
  AGENT_EMAIL_MAP: z.string().optional(),
  /** Comma-separated Ringover numeric user_ids to exclude (extends the hardcoded Vida set) */
  VIDA_AGENT_IDS: z.string().optional(),
  /** Comma-separated product names to exclude from pending follow-ups. Default: "TVDE,Caravela" */
  FOLLOWUP_EXCLUDE_PRODUCTS: z.string().optional(),
  /** HS256 signing secret for the short-lived agent-panel tokens. Optional so the
   *  supervisor app still boots without it; the panel routes refuse to mint
   *  without it rather than falling back to a guessable default. */
  AGENT_TOKEN_SECRET: z.string().optional(),
  /** Shared secret the Zoho widget presents to /api/agente/sessao. */
  PAINEL_WIDGET_TOKEN: z.string().optional(),
  /** Public base URL of the agent panel, used to build the launch link. */
  AGENTE_APP_URL: z.string().optional(),
  /**
   * Opens `/agente/pre-visualizacao` — the panel for any agent, with NO token.
   *
   * Exists so the layout and the content can be judged before the Zoho
   * extension is installed; a 15-minute token expires halfway through that
   * conversation. Off unless it is exactly "1", and it must be switched off
   * once the extension works: while on, anyone with the URL reads customer
   * phone numbers and ticket subjects.
   */
  PAINEL_PREVIEW_ENABLED: z.string().optional(),
});

let cached: z.infer<typeof envSchema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
