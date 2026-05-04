import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, runsTable, conversationsTable } from "@workspace/db";
import { TriggerRunBody, GetRunStatusParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/run", async (req, res): Promise<void> => {
  const parsed = TriggerRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { date } = parsed.data;

  const existing = await db.select().from(runsTable).where(eq(runsTable.date, date));
  if (existing.length > 0 && existing[0].status === "running") {
    res.status(409).json({ error: "Run already in progress for this date" });
    return;
  }

  let run;
  if (existing.length > 0) {
    [run] = await db
      .update(runsTable)
      .set({ status: "pending", errorMessage: null, analyzedConversations: null, totalConversations: null, totalCostUsd: null })
      .where(eq(runsTable.date, date))
      .returning();
  } else {
    [run] = await db.insert(runsTable).values({ date, status: "pending" }).returning();
  }

  res.status(202).json(serializeRun(run));
});

router.get("/run/:date", async (req, res): Promise<void> => {
  const params = GetRunStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db.select().from(runsTable).where(eq(runsTable.date, params.data.date));
  if (!run) {
    res.status(404).json({ error: "No run found for this date" });
    return;
  }

  res.json(serializeRun(run));
});

function serializeRun(run: typeof runsTable.$inferSelect) {
  return {
    id: run.id,
    date: run.date,
    status: run.status,
    totalConversations: run.totalConversations ?? null,
    analyzedConversations: run.analyzedConversations ?? null,
    totalCostUsd: run.totalCostUsd ? Number(run.totalCostUsd) : null,
    errorMessage: run.errorMessage ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export default router;
