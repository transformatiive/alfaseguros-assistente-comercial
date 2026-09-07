import { Router, type IRouter } from "express";
import { env } from "../lib/env.js";
import { todayLisbon } from "../lib/dates.js";
import { runPainelRefresh } from "../jobs/painel-refresh.js";

const router: IRouter = Router();

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/painel/refresh
 *
 * Guarded by `X-Cron-Secret`, exactly like the other n8n-facing endpoints —
 * and unlike `POST /api/run`, the secret is required on **every** path here,
 * not only when the body says `source: "cron"`. This endpoint costs Ringover
 * and Zoho calls, so it should not be triggerable by anyone who knows the URL.
 *
 * Never invokes the language model. See `jobs/painel-refresh.ts`.
 */
router.post("/painel/refresh", (req, res, next) => {
  void (async () => {
    const cfg = env();
    if (!cfg.CRON_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Cron secret not configured on server" });
      return;
    }
    if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
      res.status(401).json({ error: "Invalid X-Cron-Secret" });
      return;
    }

    const body = (req.body ?? {}) as { date?: unknown; janelaHoras?: unknown };
    if (body.date !== undefined && (typeof body.date !== "string" || !DATA_RE.test(body.date))) {
      res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
      return;
    }
    // Bounded, not just typed: this number decides how much of Zoho's history
    // is pulled, so an unbounded one is a way to spend the org's API quota
    // from outside. A week is more than any caller here needs.
    if (
      body.janelaHoras !== undefined &&
      (typeof body.janelaHoras !== "number" ||
        !Number.isFinite(body.janelaHoras) ||
        body.janelaHoras <= 0 ||
        body.janelaHoras > 168)
    ) {
      res.status(400).json({ error: "janelaHoras must be a number between 1 and 168" });
      return;
    }

    const data = typeof body.date === "string" ? body.date : todayLisbon();
    const result = await runPainelRefresh(data, {
      janelaHoras: typeof body.janelaHoras === "number" ? body.janelaHoras : undefined,
    });

    // 200 even when one half failed: the caller is a scheduler, and the body
    // says exactly what worked. A blanket 500 would make n8n retry the half
    // that already succeeded.
    res.json(result);
  })().catch(next);
});

export default router;
