import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  SESSION_SECRET: z.string().default("change-me-in-production"),
  RINGOVER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
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
