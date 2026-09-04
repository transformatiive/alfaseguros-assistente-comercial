import { z } from "zod";

/**
 * Per-conversation analysis schema. Mirrors the OpenAPI definition in
 * `lib/api-spec/openapi.yaml` (which Orval inlines, so we hand-roll here for
 * direct LLM-output validation). Field names are canonical EU-PT per
 * HANDOVER §2.
 *
 * **These schemas reject; they do not repair.** Every field used to carry a
 * `.catch(...)` fallback, which meant `safeParse` could never fail: a
 * `qualidadeGlobal` of 9 quietly became 3, a `severidade` of "critical"
 * quietly became "media", and a missing `feedbackSupervisor` quietly became an
 * empty string. Three things went wrong at once.
 *
 * The corruption was invisible. A fabricated 3 is indistinguishable from a 3
 * the model actually meant, and that number goes into coaching an agent reads
 * about their own day. Silently inventing it is worse than losing it.
 *
 * The error path was dead. `analyzeConversation` and `analyzeCase` both
 * document that "(schema mismatch) the result is `ok: false` with the raw
 * text, so the caller can persist an `analysisError` row and continue the
 * run" — and `.catch()` made that branch unreachable in all three analysers.
 *
 * And CLAUDE.md's rule for every external boundary ("never trust LLM JSON
 * output — always `safeParse` against the analysis schema") was being followed
 * to the letter and not at all in substance.
 *
 * A rejected analysis costs one conversation, is recorded as an error the run
 * can report, and can be re-run. A silently repaired one costs the trust in
 * every number on the panel.
 */
export const desvioProcedimentoSchema = z.object({
  severidade: z.enum(["alta", "media", "baixa"]),
  titulo: z.string(),
  detalhe: z.string(),
  chamadaEspecifica: z.string().nullable(),
});

export type DesvioProcedimento = z.infer<typeof desvioProcedimentoSchema>;

export const conversationAnalysisSchema = z.object({
  categoria: z.string(),
  produto: z.string(),
  narrativaConversa: z.string(),
  arcoConversa: z.string(),
  sentimentoClienteEvolucao: z.string(),
  qualidadeGlobal: z.number().int().min(1).max(5),
  continuidade: z.string(),
  desviosProcedimento: z.array(desvioProcedimentoSchema),
  pontosPositivos: z.array(z.string()),
  feedbackSupervisor: z.string(),
  sugestaoEspecialista: z.string(),
  followUpNecessario: z.boolean(),
  followUpDescricao: z.string(),
  riscoPerdaLead: z.enum(["baixo", "medio", "alto"]),
  tags: z.array(z.string()),
  /**
   * Ticket numbers the LLM identified as genuinely relevant to THIS call.
   *
   * The one field that is legitimately allowed to be absent, and the only one:
   * conversations analysed before this feature existed have no such key, and
   * `null` is how the reader is told to fall back to date proximity. Absent is
   * therefore `.optional().default(null)` — a real statement about the field's
   * history — and not `.catch(null)`, which would also swallow a wrong *type*
   * and hand the reader a fabricated null.
   */
  ticketsRelevantes: z.array(z.string()).nullable().optional().default(null),
});

export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;

/** Section of the daily summary — one paragraph + structured bullets. */
export const summarySectionSchema = z.object({
  paragraph: z.string(),
  bullets: z.array(z.string()),
});

export type SummarySection = z.infer<typeof summarySectionSchema>;

export const automationItemSchema = z.object({
  pattern: z.string(),
  conversationCountEstimate: z.number().int().nonnegative(),
  channel: z.string(),
  feasibility: z.enum(["alta", "media", "baixa"]),
  notes: z.string(),
});

export type AutomationItem = z.infer<typeof automationItemSchema>;

export const automationOpportunitiesSchema = z.object({
  paragraph: z.string(),
  items: z.array(automationItemSchema),
});

export type AutomationOpportunities = z.infer<typeof automationOpportunitiesSchema>;

export const dailySummarySchema = z.object({
  executiveSummary: z.string(),
  workingWell: summarySectionSchema,
  toImprove: summarySectionSchema,
  risks: summarySectionSchema,
  closingRateRecommendations: summarySectionSchema,
  automationOpportunities: automationOpportunitiesSchema,
});

export type DailySummaryAnalysis = z.infer<typeof dailySummarySchema>;

export const operatorSummarySchema = z.object({
  paragraphOverview: z.string(),
  strengths: z.array(z.string()),
  blindSpots: z.array(z.string()),
  closingRateObservations: z.string(),
  coachingRecommendations: z.array(z.string()),
});

export type OperatorSummaryAnalysis = z.infer<typeof operatorSummarySchema>;
