/**
 * GET /api/email/summary?date=YYYY-MM-DD
 *
 * Single endpoint for n8n to pull all data needed for the daily summary email.
 * Authenticated with the same Bearer token as /api/followups/*.
 *
 * Returns executive summary + operator coaching + stats for the given date.
 * If `date` is omitted, defaults to today in the Europe/Lisbon timezone.
 */
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  dailySummariesTable,
  operatorSummariesTable,
  conversationsTable,
  runsTable,
} from "@workspace/db";
import { env } from "../lib/env.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bearer-token auth (shared with /api/followups/*)
// ---------------------------------------------------------------------------
function checkToken(req: Parameters<typeof router.get>[1] extends (...args: infer A) => unknown ? A[0] : never, res: Parameters<typeof router.get>[1] extends (...args: infer A) => unknown ? A[1] : never): boolean {
  const token = env().FOLLOWUP_API_TOKEN;
  if (!token) {
    res.status(503).json({ error: "FOLLOWUP_API_TOKEN not configured on server" });
    return false;
  }
  const header = String(req.headers["authorization"] ?? "");
  if (header !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers (shared with summary route)
// ---------------------------------------------------------------------------
function normalizeSection(raw: unknown): { paragraph: string; bullets: string[] } {
  if (Array.isArray(raw)) {
    return { paragraph: "", bullets: raw.filter((b): b is string => typeof b === "string") };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      paragraph: typeof o.paragraph === "string" ? o.paragraph : "",
      bullets: Array.isArray(o.bullets)
        ? o.bullets.filter((b): b is string => typeof b === "string")
        : [],
    };
  }
  return { paragraph: "", bullets: [] };
}

/** Today's date string (YYYY-MM-DD) in Europe/Lisbon timezone */
function todayLisbon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

// ---------------------------------------------------------------------------
// GET /api/email/summary
// ---------------------------------------------------------------------------
router.get("/email/summary", async (req, res): Promise<void> => {
  if (!checkToken(req as never, res as never)) return;

  const dateParam =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayLisbon();

  // Parallel queries
  const [summary, operators, convStats, run] = await Promise.all([
    db
      .select()
      .from(dailySummariesTable)
      .where(eq(dailySummariesTable.date, dateParam))
      .limit(1),

    db
      .select()
      .from(operatorSummariesTable)
      .where(eq(operatorSummariesTable.date, dateParam))
      .orderBy(operatorSummariesTable.operatorName),

    db
      .select({
        total: sql<number>`count(*)::int`,
        withFollowUp: sql<number>`count(*) filter (where ${conversationsTable.analysisJson}->>'followUpNecessario' = 'true')::int`,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.runDate, dateParam)),

    db
      .select({ status: runsTable.status, completedAt: runsTable.updatedAt })
      .from(runsTable)
      .where(eq(runsTable.date, dateParam))
      .limit(1),
  ]);

  const s = summary[0];
  const r = run[0];
  const stats = convStats[0] ?? { total: 0, withFollowUp: 0 };

  if (!s) {
    res.status(404).json({
      error: "Sem análise para esta data",
      date: dateParam,
      hint: r
        ? `Run encontrada com status '${r.status}' — análise pode estar em progresso`
        : "Nenhuma análise foi executada para esta data",
    });
    return;
  }

  res.json({
    date: dateParam,
    run_status: r?.status ?? null,
    executive_summary: s.executiveSummary ?? "",
    sections: {
      working_well: normalizeSection(s.workingWell),
      to_improve: normalizeSection(s.toImprove),
      risks: normalizeSection(s.risks),
      closing_rate_recommendations: normalizeSection(s.closingRateRecommendations),
    },
    operators: operators.map((op) => ({
      name: op.operatorName,
      overview: op.paragraphOverview ?? "",
      strengths: op.strengths ?? [],
      blind_spots: op.blindSpots ?? [],
      coaching: op.coachingRecommendations ?? [],
    })),
    stats: {
      total_conversations: stats.total,
      with_follow_up: stats.withFollowUp,
      operators_analyzed: operators.length,
    },
  });
});

export default router;
