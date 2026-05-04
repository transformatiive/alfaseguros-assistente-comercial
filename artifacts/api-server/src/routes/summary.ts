import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, dailySummariesTable } from "@workspace/db";
import { GetDailySummaryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/summary/:date", async (req, res): Promise<void> => {
  const params = GetDailySummaryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [summary] = await db
    .select()
    .from(dailySummariesTable)
    .where(eq(dailySummariesTable.date, params.data.date));

  if (!summary) {
    res.status(404).json({ error: "No summary found for this date" });
    return;
  }

  res.json({
    id: summary.id,
    date: summary.date,
    workingWell: summary.workingWell ?? [],
    toImprove: summary.toImprove ?? [],
    risks: summary.risks ?? [],
    closingRateRecommendations: summary.closingRateRecommendations ?? [],
    automationOpportunities: summary.automationOpportunities ?? [],
    createdAt: summary.createdAt.toISOString(),
  });
});

export default router;
