import { z } from "zod";

/**
 * Per-conversation analysis schema. Mirrors the OpenAPI definition in
 * `lib/api-spec/openapi.yaml` (which Orval inlines, so we hand-roll here for
 * direct LLM-output validation). Field names are canonical EU-PT per
 * HANDOVER §2.
 */
export const desvioProcedimentoSchema = z.object({
  severidade: z.enum(["alta", "media", "baixa"]).catch("media"),
  titulo: z.string().catch("(sem título)"),
  detalhe: z.string().catch(""),
  chamadaEspecifica: z.string().nullable().catch(null),
});

export type DesvioProcedimento = z.infer<typeof desvioProcedimentoSchema>;

export const conversationAnalysisSchema = z.object({
  categoria: z.string().catch("Outro"),
  produto: z.string().catch("Outro"),
  narrativaConversa: z.string().catch(""),
  arcoConversa: z.string().catch(""),
  sentimentoClienteEvolucao: z.string().catch(""),
  qualidadeGlobal: z.number().int().min(1).max(5).catch(3),
  continuidade: z.string().catch(""),
  desviosProcedimento: z.array(desvioProcedimentoSchema).catch([]),
  pontosPositivos: z.array(z.string()).catch([]),
  feedbackSupervisor: z.string().catch(""),
  sugestaoEspecialista: z.string().catch(""),
  followUpNecessario: z.boolean().catch(false),
  followUpDescricao: z.string().catch(""),
  riscoPerdaLead: z.enum(["baixo", "medio", "alto"]).catch("baixo"),
  tags: z.array(z.string()).catch([]),
});

export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;

/** Section of the daily summary — one paragraph + structured bullets. */
export const summarySectionSchema = z.object({
  paragraph: z.string().catch(""),
  bullets: z.array(z.string()).catch([]),
});

export type SummarySection = z.infer<typeof summarySectionSchema>;

export const automationItemSchema = z.object({
  pattern: z.string().catch(""),
  conversationCountEstimate: z.number().int().nonnegative().catch(0),
  channel: z.string().catch(""),
  feasibility: z.enum(["alta", "media", "baixa"]).catch("media"),
  notes: z.string().catch(""),
});

export type AutomationItem = z.infer<typeof automationItemSchema>;

export const automationOpportunitiesSchema = z.object({
  paragraph: z.string().catch(""),
  items: z.array(automationItemSchema).catch([]),
});

export type AutomationOpportunities = z.infer<typeof automationOpportunitiesSchema>;

const emptySummarySection = { paragraph: "", bullets: [] };

export const dailySummarySchema = z.object({
  executiveSummary: z.string().catch(""),
  workingWell: summarySectionSchema.catch(emptySummarySection),
  toImprove: summarySectionSchema.catch(emptySummarySection),
  risks: summarySectionSchema.catch(emptySummarySection),
  closingRateRecommendations: summarySectionSchema.catch(emptySummarySection),
  automationOpportunities: automationOpportunitiesSchema.catch({ paragraph: "", items: [] }),
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
