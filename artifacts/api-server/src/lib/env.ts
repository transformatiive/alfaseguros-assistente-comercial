import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  RINGOVER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4-5"),
  CRON_SECRET: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ZOHO_DESK_CLIENT_ID: z.string().optional(),
  ZOHO_DESK_CLIENT_SECRET: z.string().optional(),
  ZOHO_DESK_REFRESH_TOKEN: z.string().optional(),
  ZOHO_DESK_ORG_ID: z.string().optional(),
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
