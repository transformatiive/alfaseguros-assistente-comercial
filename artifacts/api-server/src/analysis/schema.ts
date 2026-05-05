import { z } from "zod";

/**
 * Per-conversation analysis schema. Mirrors the OpenAPI definition in
 * `lib/api-spec/openapi.yaml` (which Orval inlines, so we hand-roll here for
 * direct LLM-output validation). Field names are canonical EU-PT per
 * HANDOVER §2.
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
