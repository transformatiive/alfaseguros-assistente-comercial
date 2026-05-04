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
    executiveSummary: summary.executiveSummary ?? "",
    workingWell: normalizeSection(summary.workingWell),
    toImprove: normalizeSection(summary.toImprove),
    risks: normalizeSection(summary.risks),
    closingRateRecommendations: normalizeSection(summary.closingRateRecommendations),
    automationOpportunities: normalizeAutomation(summary.automationOpportunities),
    createdAt: summary.createdAt.toISOString(),
  });
});

function normalizeSection(raw: unknown): { paragraph: string; bullets: string[] } {
  if (Array.isArray(raw)) {
    return { paragraph: "", bullets: raw.filter((b): b is string => typeof b === "string") };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      paragraph: typeof o.paragraph === "string" ? o.paragraph : "",
      bullets: Array.isArray(o.bullets) ? o.bullets.filter((b): b is string => typeof b === "string") : [],
    };
  }
  return { paragraph: "", bullets: [] };
}

function normalizeAutomation(raw: unknown): { paragraph: string; items: unknown[] } {
  if (Array.isArray(raw)) {
    return {
      paragraph: "",
      items: raw.map((s) =>
        typeof s === "string"
          ? { pattern: s, conversationCountEstimate: 0, channel: "", feasibility: "media", notes: "" }
          : s,
      ),
    };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      paragraph: typeof o.paragraph === "string" ? o.paragraph : "",
      items: Array.isArray(o.items) ? o.items : [],
    };
  }
  return { paragraph: "", items: [] };
}

export default router;
