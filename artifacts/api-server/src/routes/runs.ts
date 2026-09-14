import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, runsTable } from "@workspace/db";
import { GetRunStatusParams } from "@workspace/api-zod";
import { env } from "../lib/env.js";
import {
  isValidIsoDate,
  lisbonDateOffset,
  todayLisbon,
} from "../lib/dates.js";
import { analyzeDay } from "../jobs/analyze-day.js";
import { subscribeRunEvents } from "../jobs/bus.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.post("/run", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    date?: unknown;
    date_offset?: unknown;
    source?: unknown;
    force?: unknown;
    retomar?: unknown;
  };

  // Cron path requires X-Cron-Secret if a secret is configured.
  const isCron = body.source === "cron";
  if (isCron) {
    const cfg = env();
    if (!cfg.CRON_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Cron secret not configured on server" });
      return;
    }
    const supplied = req.header("x-cron-secret");
    if (supplied !== cfg.CRON_WEBHOOK_SECRET) {
      res.status(401).json({ error: "Invalid X-Cron-Secret" });
      return;
    }
  }

  // Resolve date: explicit > date_offset > yesterday Lisbon.
  let date: string;
  if (typeof body.date === "string" && isValidIsoDate(body.date)) {
    date = body.date;
  } else if (typeof body.date_offset === "number" && Number.isFinite(body.date_offset)) {
    date = lisbonDateOffset(body.date_offset);
  } else if (isCron) {
    date = lisbonDateOffset(-1);
  } else {
    res.status(400).json({ error: "date (YYYY-MM-DD) or date_offset (number) is required" });
    return;
  }

  const force = body.force === true;
  // A scheduled catch-up: analyse what is new on a day already analysed, and
  // nothing that was analysed before. See the note on the 409 below.
  const retomar = body.retomar === true;

  const existing = await db.select().from(runsTable).where(eq(runsTable.date, date));
  if (existing.length > 0) {
    const { status, updatedAt } = existing[0];

    /*
     * Protect completed runs from accidental re-analysis, which costs money —
     * but not from the scheduler, which is the one caller that must be able to
     * come back to a finished day.
     *
     * This guard was wrong for the scheduler, and the failure was silent. The
     * morning run analyses *yesterday*; the previous afternoon's run had
     * already created a row for that date, so every morning the scheduler got
     * this 409 and stopped. Nothing downstream noticed, because a day that was
     * analysed at 16:30 looks exactly like a day that was analysed twice — the
     * only difference is the calls made after 16:30, which nothing ever read.
     *
     * `retomar` is deliberately not `force`. Force nulls every cached analysis
     * and pays for the whole day again; this takes the same path as a first
     * run, where a conversation that already has `analysisJson` is skipped.
     * The cost of a catch-up is therefore the new conversations plus the two
     * summaries, which is what the morning run was always meant to cost.
     */
    if (status === "completed" && !force && !retomar) {
      res.status(409).json({ error: "Este dia já foi analisado. Use force=true para re-analisar." });
      return;
    }

    if (status === "running") {
      // A run is considered stale if it has been "running" for > 20 minutes without
      // updating — this happens when the server restarts mid-job.
      const STALE_MS = 20 * 60 * 1000;
      const isStale = Date.now() - updatedAt.getTime() > STALE_MS;
      if (!force && !isStale) {
        res.status(409).json({ error: "Run already in progress for this date" });
        return;
      }
      logger.warn({ date, isStale, force }, "Resetting stale/forced running run");
    }
  }

  let run;
  if (existing.length > 0) {
    [run] = await db
      .update(runsTable)
      .set({
        status: "pending",
        errorMessage: null,
        analyzedConversations: null,
        totalConversations: null,
        totalCostUsd: null,
      })
      .where(eq(runsTable.date, date))
      .returning();
  } else {
    [run] = await db.insert(runsTable).values({ date, status: "pending" }).returning();
  }

  res.status(202).json(serializeRun(run));

  // Fire-and-forget the worker; analyzeDay updates the run row + emits SSE events.
  void analyzeDay({ date, force }).catch((err: unknown) => {
    // analyzeDay already records failure on the runs row. This catch keeps the
    // unhandled-rejection from crashing the process.
    logger.error({ date, err }, "analyzeDay failed");
  });
});

/**
 * PATCH /api/run/:date
 * Admin-only (X-Cron-Secret). Force-sets run status — used to recover runs
 * that were left in "running" state after a server restart mid-job.
 * Body: { "status": "completed" | "failed", "error_message"?: string }
 */
router.patch("/run/:date", async (req, res): Promise<void> => {
  const cfg = env();
  if (!cfg.CRON_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Cron secret not configured on server" });
    return;
  }
  if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
    res.status(401).json({ error: "Invalid X-Cron-Secret" });
    return;
  }

  const { date } = req.params;
  if (!isValidIsoDate(date)) {
    res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    return;
  }

  const body = (req.body ?? {}) as { status?: unknown; error_message?: unknown };
  const newStatus = body.status;
  if (newStatus !== "completed" && newStatus !== "failed") {
    res.status(400).json({ error: "status must be 'completed' or 'failed'" });
    return;
  }

  const [updated] = await db
    .update(runsTable)
    .set({
      status: newStatus,
      errorMessage: typeof body.error_message === "string" ? body.error_message : null,
    })
    .where(eq(runsTable.date, date))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "No run found for this date" });
    return;
  }

  res.json(serializeRun(updated));
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

router.get("/progress/:date", async (req, res): Promise<void> => {
  const params = GetRunStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const date = params.data.date;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Heartbeat to keep proxies from killing the connection.
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  const unsubscribe = subscribeRunEvents(date, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Helpers

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

// Re-export for tests / dashboards needing today's Lisbon date string.
export { todayLisbon };

export default router;
