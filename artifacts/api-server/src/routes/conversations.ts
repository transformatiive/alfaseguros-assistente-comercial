import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";
import { ListConversationsParams, GetConversationParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/conversations/:date", async (req, res): Promise<void> => {
  const params = ListConversationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.runDate, params.data.date))
    .orderBy(conversationsTable.createdAt);

  res.json(
    conversations.map((c) => ({
      id: c.id,
      runDate: c.runDate,
      customerPhone: c.customerPhone,
      callCount: c.callIds?.length ?? 0,
      hasAnalysis: c.analysisJson != null,
      costUsd: c.costUsd ? Number(c.costUsd) : null,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

router.get("/conversations/:date/:conversationId", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.runDate, params.data.date),
        eq(conversationsTable.id, params.data.conversationId),
      ),
    );

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({
    id: conversation.id,
    runDate: conversation.runDate,
    customerPhone: conversation.customerPhone,
    callIds: conversation.callIds ?? [],
    agentId: conversation.agentId ?? null,
    agentName: conversation.agentName ?? null,
    durationSec: conversation.durationSec ?? null,
    recordingUrls: conversation.recordingUrls ?? [],
    analysis: normalizeAnalysis(conversation.analysisJson),
    costUsd: conversation.costUsd ? Number(conversation.costUsd) : null,
    createdAt: conversation.createdAt.toISOString(),
  });
});

function normalizeAnalysis(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const desviosRaw = a.desviosProcedimento ?? a.proceduralFlags ?? [];
  const desvios = Array.isArray(desviosRaw)
    ? desviosRaw.map((f) => {
        if (typeof f === "string") {
          return { severidade: "media", titulo: f, detalhe: "", chamadaEspecifica: null };
        }
        if (f && typeof f === "object") {
          const o = f as Record<string, unknown>;
          return {
            severidade: (o.severidade ?? o.severity ?? "media") as string,
            titulo: (o.titulo ?? o.label ?? "") as string,
            detalhe: (o.detalhe ?? o.detail ?? "") as string,
            chamadaEspecifica: (o.chamadaEspecifica ?? null) as string | null,
          };
        }
        return { severidade: "media", titulo: "", detalhe: "", chamadaEspecifica: null };
      })
    : [];
  const followUpObj =
    typeof a.followUp === "object" && a.followUp != null
      ? (a.followUp as Record<string, unknown>)
      : null;
  return {
    categoria: (a.categoria as string) ?? "",
    produto: (a.produto as string) ?? "",
    narrativaConversa: (a.narrativaConversa ?? a.narrative ?? "") as string,
    arcoConversa: (a.arcoConversa as string) ?? "",
    sentimentoClienteEvolucao: (a.sentimentoClienteEvolucao as string) ?? "",
    qualidadeGlobal: typeof a.qualidadeGlobal === "number" ? a.qualidadeGlobal : 3,
    continuidade: (a.continuidade as string) ?? "",
    desviosProcedimento: desvios,
    pontosPositivos: Array.isArray(a.pontosPositivos)
      ? a.pontosPositivos
      : Array.isArray(a.positivePoints)
      ? a.positivePoints
      : [],
    feedbackSupervisor: (a.feedbackSupervisor ?? a.supervisorFeedback ?? a.coachingFeedback ?? "") as string,
    sugestaoEspecialista: (a.sugestaoEspecialista ?? a.specialistSuggestions ?? "") as string,
    followUpNecessario:
      typeof a.followUpNecessario === "boolean"
        ? a.followUpNecessario
        : followUpObj != null,
    followUpDescricao:
      (a.followUpDescricao as string) ??
      (followUpObj && typeof followUpObj.action === "string" ? followUpObj.action : "") ??
      "",
    riscoPerdaLead:
      (a.riscoPerdaLead as string) ??
      (a.riskLevel as string) ??
      "baixo",
    tags: Array.isArray(a.tags) ? a.tags : [],
  };
}

export default router;
