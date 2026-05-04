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
  const flags = Array.isArray(a.proceduralFlags)
    ? a.proceduralFlags.map((f) =>
        typeof f === "string" ? { severity: "media", label: f, detail: "" } : f,
      )
    : [];
  return {
    schemaVersion: typeof a.schemaVersion === "number" ? a.schemaVersion : 1,
    ringoverSummary: a.ringoverSummary ?? null,
    narrative: a.narrative ?? "",
    proceduralFlags: flags,
    positivePoints: Array.isArray(a.positivePoints) ? a.positivePoints : [],
    supervisorFeedback: a.supervisorFeedback ?? a.coachingFeedback ?? "",
    specialistSuggestions: a.specialistSuggestions ?? "",
    followUp: a.followUp ?? null,
    riskAssessment: a.riskAssessment ?? "",
    sentiment: a.sentiment ?? null,
    riskLevel: a.riskLevel ?? null,
    leadTemperature: a.leadTemperature ?? null,
    tags: Array.isArray(a.tags) ? a.tags : [],
  };
}

export default router;
