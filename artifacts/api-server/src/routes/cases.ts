import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  casesTable,
  caseCallsTable,
  caseTicketsTable,
  conversationsTable,
} from "@workspace/db";
import { ListOperatorSummariesParams as ListCasesParams } from "@workspace/api-zod";
import type { ConversationAnalysis } from "../analysis/schema.js";

const router: IRouter = Router();

router.get("/cases/:date", async (req, res): Promise<void> => {
  const params = ListCasesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { date } = params.data;

  // Find all conversations for this date
  const convRows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.runDate, date));

  if (convRows.length === 0) {
    res.json([]);
    return;
  }

  const convIds = convRows.map((c) => c.id);

  // Find cases linked to those conversations
  const caseCallRows = await db
    .select({ caseId: caseCallsTable.caseId, conversationId: caseCallsTable.conversationId })
    .from(caseCallsTable)
    .where(inArray(caseCallsTable.conversationId, convIds));

  if (caseCallRows.length === 0) {
    res.json([]);
    return;
  }

  const caseIds = [...new Set(caseCallRows.map((r) => r.caseId))];

  // Build conversationIds per case
  const convIdsByCaseId = new Map<string, number[]>();
  for (const r of caseCallRows) {
    const list = convIdsByCaseId.get(r.caseId) ?? [];
    list.push(r.conversationId);
    convIdsByCaseId.set(r.caseId, list);
  }

  // Fetch linked ticket IDs per case
  const caseTicketRows = await db
    .select({ caseId: caseTicketsTable.caseId, ticketId: caseTicketsTable.ticketId })
    .from(caseTicketsTable)
    .where(inArray(caseTicketsTable.caseId, caseIds));
  const ticketIdsByCaseId = new Map<string, string[]>();
  for (const r of caseTicketRows) {
    const list = ticketIdsByCaseId.get(r.caseId) ?? [];
    list.push(r.ticketId);
    ticketIdsByCaseId.set(r.caseId, list);
  }

  // Fetch cases
  const cases = await db
    .select()
    .from(casesTable)
    .where(inArray(casesTable.id, caseIds));

  res.json(
    cases
      .sort((a, b) => {
        const ta = a.lastActivityAt?.getTime() ?? 0;
        const tb = b.lastActivityAt?.getTime() ?? 0;
        return tb - ta;
      })
      .map((c) => ({
        id: c.id,
        customerPhone: c.customerPhone ?? null,
        customerName: c.customerName ?? null,
        productName: c.productName ?? null,
        primaryAgentName: c.primaryAgentName ?? null,
        firstActivityAt: c.firstActivityAt ? c.firstActivityAt.toISOString() : null,
        lastActivityAt: c.lastActivityAt ? c.lastActivityAt.toISOString() : null,
        outcomeStatus: c.outcomeStatus,
        legCount: c.legCount,
        conversationIds: convIdsByCaseId.get(c.id) ?? [],
        ticketIds: ticketIdsByCaseId.get(c.id) ?? [],
        timeline: Array.isArray(c.timelineJson) ? c.timelineJson : [],
        analysis: c.analysisJson ? normalizeAnalysis(c.analysisJson) : null,
        costUsd: c.costUsd ? Number(c.costUsd) : null,
      })),
  );
});

function normalizeAnalysis(raw: unknown): ConversationAnalysis | null {
  if (raw == null || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    categoria: (a.categoria as string) ?? "",
    produto: (a.produto as string) ?? "",
    narrativaConversa: (a.narrativaConversa as string) ?? "",
    arcoConversa: (a.arcoConversa as string) ?? "",
    sentimentoClienteEvolucao: (a.sentimentoClienteEvolucao as string) ?? "",
    qualidadeGlobal: typeof a.qualidadeGlobal === "number" ? a.qualidadeGlobal : 3,
    continuidade: (a.continuidade as string) ?? "",
    desviosProcedimento: Array.isArray(a.desviosProcedimento) ? a.desviosProcedimento as ConversationAnalysis["desviosProcedimento"] : [],
    pontosPositivos: Array.isArray(a.pontosPositivos) ? a.pontosPositivos as string[] : [],
    feedbackSupervisor: (a.feedbackSupervisor as string) ?? "",
    sugestaoEspecialista: (a.sugestaoEspecialista as string) ?? "",
    followUpNecessario: typeof a.followUpNecessario === "boolean" ? a.followUpNecessario : false,
    followUpDescricao: (a.followUpDescricao as string) ?? "",
    riscoPerdaLead: (a.riscoPerdaLead as "baixo" | "medio" | "alto") ?? "baixo",
    tags: Array.isArray(a.tags) ? a.tags as string[] : [],
  };
}

export default router;
