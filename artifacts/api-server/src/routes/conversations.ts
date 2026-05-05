import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, conversationsTable, ticketsTable, ticketCommentsTable } from "@workspace/db";
import { ListConversationsParams, GetConversationParams } from "@workspace/api-zod";
import { phoneFingerprint } from "@workspace/phone";

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

  // Batch-fetch ticket counts by phone fingerprint (single query, no N+1).
  const fingerprints = [
    ...new Set(
      conversations
        .map((c) => phoneFingerprint(c.customerPhone))
        .filter((fp): fp is string => !!fp),
    ),
  ];
  const ticketCountByFp = new Map<string, number>();
  if (fingerprints.length > 0) {
    const rows = await db
      .select({ fp: ticketsTable.phoneFingerprint, id: ticketsTable.id })
      .from(ticketsTable)
      .where(inArray(ticketsTable.phoneFingerprint, fingerprints));
    for (const row of rows) {
      if (!row.fp) continue;
      ticketCountByFp.set(row.fp, (ticketCountByFp.get(row.fp) ?? 0) + 1);
    }
  }

  res.json(
    conversations.map((c) => {
      const a = (c.analysisJson ?? null) as Record<string, unknown> | null;
      const callCount = c.callIds?.length ?? 0;
      const desvios = Array.isArray(a?.desviosProcedimento)
        ? (a!.desviosProcedimento as unknown[]).length
        : 0;
      const fp = phoneFingerprint(c.customerPhone);
      return {
        id: c.id,
        runDate: c.runDate,
        customerPhone: c.customerPhone,
        callCount,
        agentId: c.agentId ?? null,
        agentName: c.agentName ?? null,
        durationSec: c.durationSec ?? null,
        isMultiLeg: callCount > 1,
        hasAnalysis: a != null,
        categoria: typeof a?.categoria === "string" ? a.categoria : null,
        produto: typeof a?.produto === "string" ? a.produto : null,
        qualidadeGlobal:
          typeof a?.qualidadeGlobal === "number" ? a.qualidadeGlobal : null,
        riscoPerdaLead:
          typeof a?.riscoPerdaLead === "string" ? a.riscoPerdaLead : null,
        desviosCount: desvios,
        followUpNecessario: a?.followUpNecessario === true,
        deskTicketCount: fp ? (ticketCountByFp.get(fp) ?? 0) : 0,
        startTime: c.createdAt.toISOString(),
        costUsd: c.costUsd ? Number(c.costUsd) : null,
        createdAt: c.createdAt.toISOString(),
      };
    }),
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

  const fp = phoneFingerprint(conversation.customerPhone);
  const tickets = fp
    ? await db
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.phoneFingerprint, fp))
    : [];

  // Fetch comments for all matched tickets
  const ticketIds = tickets.map((t) => t.id);
  const comments =
    ticketIds.length > 0
      ? await db
          .select()
          .from(ticketCommentsTable)
          .where(inArray(ticketCommentsTable.ticketId, ticketIds))
          .orderBy(ticketCommentsTable.commentedTime)
      : [];

  const commentsByTicket = new Map<string, typeof comments>();
  for (const c of comments) {
    const list = commentsByTicket.get(c.ticketId) ?? [];
    list.push(c);
    commentsByTicket.set(c.ticketId, list);
  }

  // Normalize stored legsJson
  const legsRaw = Array.isArray(conversation.legsJson) ? conversation.legsJson : [];
  const legs = legsRaw.map((l: unknown) => {
    const leg = l as Record<string, unknown>;
    return {
      callId: String(leg.callId ?? ""),
      agentName: (leg.agentName as string | null) ?? null,
      direction: (leg.direction as string | null) ?? null,
      startTime: (leg.startTime as string | null) ?? null,
      durationSec: typeof leg.durationSec === "number" ? leg.durationSec : 0,
      ringoverSummary: String(leg.ringoverSummary ?? ""),
    };
  });

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
    legs,
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber ?? null,
      subject: t.subject ?? null,
      status: t.status ?? null,
      category: t.category ?? null,
      productName: t.productName ?? null,
      contactName: t.contactName ?? null,
      assigneeName: t.assigneeName ?? null,
      outcomeStatus: t.outcomeStatus ?? null,
      createdTime: t.createdTime ? t.createdTime.toISOString() : null,
      modifiedTime: t.modifiedTime ? t.modifiedTime.toISOString() : null,
      comments: (commentsByTicket.get(t.id) ?? []).map((c) => ({
        id: c.id,
        commentedTime: c.commentedTime ? c.commentedTime.toISOString() : null,
        channel: c.channel ?? null,
        authorType: c.authorType ?? null,
        authorName: c.authorName ?? null,
        content: c.contentSanitized,
      })),
    })),
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
