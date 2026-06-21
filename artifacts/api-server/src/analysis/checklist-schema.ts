import { z } from "zod";
import { ESTADOS, FASES } from "@workspace/db/schema";

/**
 * Structured per-point evaluation produced by the LLM for one conversation,
 * for the Supervisor Virtual V2 checklist (TRNSF-1178).
 *
 * The model receives the call transcript plus the applicable checklist items
 * (by id) and returns, per item, one of four states + a short evidence quote,
 * together with the inferred sales-script phase. Never trust the raw output —
 * always validate with {@link checklistAnalysisSchema} and then reconcile
 * against the known item ids (see checklist-analyzer.ts).
 */
export const checklistPointResultSchema = z.object({
  itemId: z.number().int(),
  // cumprido | nao_cumprido | nao_aplicavel | indeterminado
  estado: z.enum(ESTADOS).catch("indeterminado"),
  // Short transcript quote or justification; "" when none.
  evidencia: z.string().catch(""),
});

export type ChecklistPointResult = z.infer<typeof checklistPointResultSchema>;

export const checklistAnalysisSchema = z.object({
  // primeiro_contacto | follow_up | proposta | pos_venda
  faseDetectada: z.enum(FASES).catch("primeiro_contacto"),
  resultados: z.array(checklistPointResultSchema).catch([]),
});

export type ChecklistAnalysis = z.infer<typeof checklistAnalysisSchema>;
