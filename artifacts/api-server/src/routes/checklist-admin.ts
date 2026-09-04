/**
 * Admin/ops endpoints for the V2 checklist, guarded by the cron secret
 * (X-Cron-Secret == CRON_WEBHOOK_SECRET). Needed because the autoscale
 * deployment uses a separate PROD database: the app must seed itself and
 * backfill there, since the workspace shell can't reach the PROD db.
 *
 *   POST /api/checklist/seed              — apply the Vida Fase 1 seed (idempotent)
 *   POST /api/checklist/backfill?data=…   — run the Vida checklist over stored calls
 *   GET  /api/checklist/stats?data=…      — diagnostics (state distribution)
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { seedVidaFase1 } from "@workspace/db/seed";
import { OpenRouterClient } from "@workspace/openrouter";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { backfillVidaChecklistForDate } from "../jobs/vida-checklist.js";
import { backfillRecordingsForDate } from "../jobs/backfill-recordings.js";
import { checklistDistribution, countVidaConversationsForDate } from "../storage/repo.js";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const requireCronSecret: RequestHandler = (req, res, next) => {
  const cfg = env();
  if (!cfg.CRON_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Cron secret not configured on server" });
    return;
  }
  if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
    res.status(401).json({ error: "Invalid X-Cron-Secret" });
    return;
  }
  next();
};

router.post("/checklist/seed", requireCronSecret, async (_req, res): Promise<void> => {
  const result = await seedVidaFase1(db);
  logger.info(result, "Vida seed applied via admin endpoint");
  res.json({ ok: true, ...result });
});

router.post("/checklist/backfill", requireCronSecret, async (req, res): Promise<void> => {
  const data = typeof req.query.data === "string" && DATE_RE.test(req.query.data) ? req.query.data : "";
  if (!data) {
    res.status(400).json({ error: "Parâmetro 'data' (YYYY-MM-DD) é obrigatório" });
    return;
  }
  const force = req.query.force === "true";
  const cfg = env();
  if (!cfg.OPENROUTER_API_KEY) {
    res.status(503).json({ error: "OPENROUTER_API_KEY not configured" });
    return;
  }
  const client = new OpenRouterClient({
    apiKey: cfg.OPENROUTER_API_KEY,
    appReferer: cfg.PUBLIC_APP_URL,
    appTitle: "Alfaseguros Supervisor Virtual",
  });
  const result = await backfillVidaChecklistForDate({
    date: data,
    client,
    model: cfg.OPENROUTER_MODEL_CHECKLIST,
    concurrency: cfg.ANALYSIS_CONCURRENCY,
    force,
  });
  res.json({ ok: true, data, ...result });
});

/**
 * POST /api/recordings/backfill?data=YYYY-MM-DD
 * Repopulate recordingUrls on stored conversations from Ringover, without an
 * LLM re-analysis (cheap fix for rows persisted before recording extraction).
 */
router.post("/recordings/backfill", requireCronSecret, async (req, res): Promise<void> => {
  const data = typeof req.query.data === "string" && DATE_RE.test(req.query.data) ? req.query.data : "";
  if (!data) {
    res.status(400).json({ error: "Parâmetro 'data' (YYYY-MM-DD) é obrigatório" });
    return;
  }
  const cfg = env();
  if (!cfg.RINGOVER_API_KEY) {
    res.status(503).json({ error: "RINGOVER_API_KEY not configured" });
    return;
  }
  const result = await backfillRecordingsForDate(data);
  logger.info(result, "recordings backfill via admin endpoint");
  res.json({ ok: true, ...result });
});

router.get("/checklist/stats", requireCronSecret, async (req, res): Promise<void> => {
  const data = typeof req.query.data === "string" && DATE_RE.test(req.query.data) ? req.query.data : null;
  const dist = await checklistDistribution();
  const conversasVida = data ? await countVidaConversationsForDate(data) : null;
  res.json({ data, conversasVida, ...dist });
});

export default router;
