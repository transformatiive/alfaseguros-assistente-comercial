/**
 * GET /leads — public, server-rendered HTML dashboard of site/partnership leads
 * (Zoho Desk), for the CEO to open from the daily email. No auth (URL is not
 * indexed/shared); no DB — data is live from Desk with a 15-min memory cache.
 */
import { Router, type IRouter } from "express";
import { fetchLeads, LeadsConfigError, SEM_RESPONSAVEL } from "../leads/service.js";
import { resolvePeriod, buildView, buildEmailSummary, todayLisbon, addDays } from "../leads/compute.js";
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
    const filters = {
      canal: q.canal || undefined,
      tipo: q.tipo || undefined,
      pessoa: q.pessoa || undefined,
    };
    const view = buildView(rows, period, today, Number.isFinite(page) ? page : 1, filters, SEM_RESPONSAVEL);
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

/**
 * GET /leads/resumo.json — counts per channel and per lead type for the daily
 * leads email (n8n builds the HTML). Same data and rules as the dashboard, so
 * the email and the panel never disagree. Counts only: no names, no subjects.
 */
router.get("/leads/resumo.json", async (req, res): Promise<void> => {
  const today = todayLisbon();
  // Today + the previous 59 days covers the 30-day window and the one before it.
  const from = addDays(today, -59);
  try {
    const rows = await fetchLeads(from, today);
    const painelUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}/leads`;
    res.json(buildEmailSummary(rows, today, painelUrl));
  } catch (err) {
    const isConfig = err instanceof LeadsConfigError;
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "leads.resumo_failed");
    res.status(isConfig ? 503 : 502).json({ error: isConfig ? (err as Error).message : "Falha a obter os dados do Zoho Desk." });
  }
});

export default router;
