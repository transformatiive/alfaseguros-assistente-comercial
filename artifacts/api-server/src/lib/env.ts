import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  RINGOVER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4"),
  CRON_SECRET: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(4),
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
