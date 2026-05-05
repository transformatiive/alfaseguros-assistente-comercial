import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, operatorSummariesTable, conversationsTable } from "@workspace/db";
import { ListOperatorSummariesParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/operators/:date", async (req, res): Promise<void> => {
  const params = ListOperatorSummariesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { date } = params.data;

  const [operators, conversations] = await Promise.all([
    db
      .select()
      .from(operatorSummariesTable)
      .where(eq(operatorSummariesTable.date, date))
      .orderBy(operatorSummariesTable.operatorName),
    db
      .select({ id: conversationsTable.id, agentId: conversationsTable.agentId })
      .from(conversationsTable)
      .where(eq(conversationsTable.runDate, date)),
  ]);

  // Build a map of agentId → conversation ids for O(1) lookup
  const convsByAgent = new Map<string, number[]>();
  for (const c of conversations) {
    if (!c.agentId) continue;
    const arr = convsByAgent.get(c.agentId) ?? [];
    arr.push(c.id);
    convsByAgent.set(c.agentId, arr);
  }

  res.json(
    operators.map((op) => ({
      id: op.id,
      date: op.date,
      operatorId: op.operatorId,
      operatorName: op.operatorName,
      paragraphOverview: op.paragraphOverview ?? "",
      strengths: op.strengths ?? [],
      blindSpots: op.blindSpots ?? [],
      closingRateObservations: op.closingRateObservations ?? "",
      coachingRecommendations: op.coachingRecommendations ?? [],
      conversationIds: convsByAgent.get(op.operatorId) ?? [],
      createdAt: op.createdAt.toISOString(),
    })),
  );
});

export default router;
