/**
 * GET /leads — public, server-rendered HTML dashboard of site/partnership leads
 * (Zoho Desk), for the CEO to open from the daily email. No auth (URL is not
 * indexed/shared); no DB — data is live from Desk with a 15-min memory cache.
 */
import { Router, type IRouter } from "express";
import { fetchLeads, LeadsConfigError } from "../leads/service.js";
import { resolvePeriod, buildView, todayLisbon } from "../leads/compute.js";
import { renderLeadsPage, renderErrorPage } from "../leads/render.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/leads", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const today = todayLisbon();
  const period = resolvePeriod({ preset: q.preset, from: q.from, to: q.to }, today);
  const page = Number.parseInt(q.page ?? "1", 10);

  // The router is mounted both at app level ("/leads") and under /api
  // ("/api/leads"); use the real path so internal links stay on this route.
  const base = `${req.baseUrl}/leads`;

  try {
    // One fetch covers both the period and its preceding comparison window.
    const rows = await fetchLeads(period.prevFrom, period.to);
    const view = buildView(rows, period, today, Number.isFinite(page) ? page : 1);
    res.set("Content-Type", "text/html; charset=utf-8").send(renderLeadsPage(view, base));
  } catch (err) {
    const isConfig = err instanceof LeadsConfigError;
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "leads.render_failed");
    const msg = isConfig
      ? (err as Error).message
      : isTimeout
        ? "O Zoho Desk demorou demasiado a responder. Tenta novamente dentro de momentos."
        : "Ocorreu um erro a obter os dados do Zoho Desk. Tenta novamente dentro de momentos.";
    res.status(isConfig ? 503 : 502).set("Content-Type", "text/html; charset=utf-8").send(renderErrorPage(msg));
  }
});

export default router;
