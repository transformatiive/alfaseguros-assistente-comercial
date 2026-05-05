import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, operatorSummariesTable } from "@workspace/db";
import { ListOperatorSummariesParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/operators/:date", async (req, res): Promise<void> => {
  const params = ListOperatorSummariesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const operators = await db
    .select()
    .from(operatorSummariesTable)
    .where(eq(operatorSummariesTable.date, params.data.date))
    .orderBy(operatorSummariesTable.operatorName);

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
      createdAt: op.createdAt.toISOString(),
    })),
  );
});

export default router;
