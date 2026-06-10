/**
 * GET /api/email/summary?date=YYYY-MM-DD
 *
 * Daily email data endpoint for n8n. Returns:
 *  - Global executive summary + sections (backward-compat)
 *  - teams.360 and teams.vida: per-team summaries generated lazily on first
 *    request, then cached in daily_summaries.team_summaries_json
 *  - operators: per-operator coaching; 360 operators include followups[] with
 *    optional desk_url when a Zoho ticket is linked to the conversation
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { eq, sql, inArray } from "drizzle-orm";
import {
  db,
  dailySummariesTable,
  operatorSummariesTable,
  conversationsTable,
  runsTable,
  ticketsTable,
} from "@workspace/db";
import { OpenRouterClient } from "@workspace/openrouter";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getTeam, normalizeOperatorName } from "../lib/teams.js";
import { conversationAnalysisSchema } from "../analysis/schema.js";
import {
  generateDailySummary,
  type AnalyzedConversationRef,
} from "../analysis/summarizer.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth — same Bearer-token scheme as /api/followups/*
// ---------------------------------------------------------------------------
const requireToken: RequestHandler = (req, res, next) => {
  const token = env().FOLLOWUP_API_TOKEN;
  if (!token) {
    res.status(503).json({ error: "FOLLOWUP_API_TOKEN not configured on server" });
    return;
  }
  if (req.headers["authorization"] !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TeamSection {
  bullets: string[];
}

interface TeamSummary {
  executive_summary: string;
  sections: {
    working_well: TeamSection;
    to_improve: TeamSection;
    risks: TeamSection;
  };
}

interface TeamSummariesCache {
  "360"?: TeamSummary;
  vida?: TeamSummary;
}

interface FollowUp {
  action: string;
  conversation_id: string;
  desk_ticket_id?: string;
  desk_url?: string;
}

// ---------------------------------------------------------------------------
// Helpers
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

function todayLisbon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/**
 * Generate per-team executive summaries using the existing daily-summary LLM
 * function, but feeding only the conversations belonging to each team.
 * Result is cached in daily_summaries.team_summaries_json to avoid repeat costs.
 */
async function generateAndCacheTeamSummaries(
  convRefs: AnalyzedConversationRef[],
  date: string,
  summaryId: number,
): Promise<TeamSummariesCache | null> {
  const cfg = env();
  if (!cfg.OPENROUTER_API_KEY) {
    logger.warn({ date }, "OPENROUTER_API_KEY not set — skipping team summary generation");
    return null;
  }

  try {
    const client = new OpenRouterClient({ apiKey: cfg.OPENROUTER_API_KEY });
    const model = cfg.OPENROUTER_MODEL;

    const convs360 = convRefs.filter(c => getTeam(c.agentName) === "360");
    const convsVida = convRefs.filter(c => getTeam(c.agentName) === "vida");

    logger.info({ date, count360: convs360.length, countVida: convsVida.length }, "Generating team summaries");

    const [outcome360, outcomeVida] = await Promise.all([
      convs360.length > 0
        ? generateDailySummary(convs360, date, { client, model })
        : null,
      convsVida.length > 0
        ? generateDailySummary(convsVida, date, { client, model })
        : null,
    ]);

    const cache: TeamSummariesCache = {};

    if (outcome360?.ok) {
      cache["360"] = {
        executive_summary: outcome360.summary.executiveSummary,
        sections: {
          working_well: { bullets: outcome360.summary.workingWell.bullets },
          to_improve:   { bullets: outcome360.summary.toImprove.bullets },
          risks:        { bullets: outcome360.summary.risks.bullets },
        },
      };
    } else if (outcome360 && !outcome360.ok) {
      logger.warn({ date, error: outcome360.error }, "Team 360 summary generation failed");
    }

    if (outcomeVida?.ok) {
      cache["vida"] = {
        executive_summary: outcomeVida.summary.executiveSummary,
        sections: {
          working_well: { bullets: outcomeVida.summary.workingWell.bullets },
          to_improve:   { bullets: outcomeVida.summary.toImprove.bullets },
          risks:        { bullets: outcomeVida.summary.risks.bullets },
        },
      };
    } else if (outcomeVida && !outcomeVida.ok) {
      logger.warn({ date, error: outcomeVida.error }, "Team Vida summary generation failed");
    }

    // Cache in DB — subsequent calls return immediately
    await db
      .update(dailySummariesTable)
      .set({ teamSummariesJson: cache })
      .where(eq(dailySummariesTable.id, summaryId));

    logger.info({ date, has360: !!cache["360"], hasVida: !!cache["vida"] }, "Team summaries cached");
    return cache;
  } catch (err) {
    logger.warn({ date, err }, "Team summary generation threw — returning null");
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/email/summary
// ---------------------------------------------------------------------------
router.get("/email/summary", requireToken, async (req, res): Promise<void> => {
  const dateParam =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayLisbon();

  // Parallel fetch: summary, operators, stats, run, all conversations for the date
  const [summary, operators, convStats, run, convRows] = await Promise.all([
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

    // All conversations with analysis — needed for team summaries + follow-up links
    db
      .select({
        id: conversationsTable.id,
        customerPhone: conversationsTable.customerPhone,
        agentName: conversationsTable.agentName,
        durationSec: conversationsTable.durationSec,
        legsJson: conversationsTable.legsJson,
        analysisJson: conversationsTable.analysisJson,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.runDate, dateParam)),
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

  // ---------------------------------------------------------------------------
  // Parse conversations into AnalyzedConversationRef[]
  // ---------------------------------------------------------------------------
  const convRefs: AnalyzedConversationRef[] = [];
  for (const c of convRows) {
    if (!c.analysisJson) continue;
    const parsed = conversationAnalysisSchema.safeParse(c.analysisJson);
    if (!parsed.success) continue;
    convRefs.push({
      rowId: c.id,
      customerPhone: c.customerPhone,
      agentName: c.agentName,
      legCount: Array.isArray(c.legsJson) ? (c.legsJson as unknown[]).length : 1,
      durationSec: c.durationSec ?? 0,
      analysis: parsed.data,
    });
  }

  // ---------------------------------------------------------------------------
  // Team summaries — load from cache or generate lazily
  // ---------------------------------------------------------------------------
  let teamsCache = s.teamSummariesJson as TeamSummariesCache | null;

  if (!teamsCache && convRefs.length > 0) {
    teamsCache = await generateAndCacheTeamSummaries(convRefs, dateParam, s.id);
  }

  // ---------------------------------------------------------------------------
  // Follow-ups for 360 operators — with Zoho Desk ticket links when available
  // ---------------------------------------------------------------------------

  // Collect all ticketsRelevantes from 360 follow-up conversations
  const followUpConvs360 = convRefs.filter(
    c => c.analysis.followUpNecessario && getTeam(c.agentName) === "360",
  );

  const allTicketNumbers = [
    ...new Set(followUpConvs360.flatMap(c => c.analysis.ticketsRelevantes ?? [])),
  ].filter(Boolean);

  // Batch-load matching tickets (ticketNumber → Zoho id)
  const ticketNumberToId = new Map<string, string>();
  if (allTicketNumbers.length > 0) {
    const ticketRows = await db
      .select({ id: ticketsTable.id, ticketNumber: ticketsTable.ticketNumber })
      .from(ticketsTable)
      .where(inArray(ticketsTable.ticketNumber, allTicketNumbers));
    for (const t of ticketRows) {
      if (t.ticketNumber) ticketNumberToId.set(t.ticketNumber, t.id);
    }
  }

  // Build followups grouped by normalized operator name
  const followupsByNormName = new Map<string, FollowUp[]>();
  for (const c of followUpConvs360) {
    const normName = normalizeOperatorName(c.agentName ?? "");
    const existing = followupsByNormName.get(normName) ?? [];

    const ticketNums = c.analysis.ticketsRelevantes ?? [];
    const deskTicketId = ticketNums
      .map(tn => ticketNumberToId.get(tn))
      .find((id): id is string => Boolean(id));

    const followup: FollowUp = {
      action: c.analysis.followUpDescricao,
      conversation_id: String(c.rowId),
      ...(deskTicketId
        ? {
            desk_ticket_id: deskTicketId,
            desk_url: `https://desk.zoho.com/support/alfaseguros/ShowHomePage.do#Cases/dv/${deskTicketId}`,
          }
        : {}),
    };

    existing.push(followup);
    followupsByNormName.set(normName, existing);
  }

  // ---------------------------------------------------------------------------
  // Response
  // ---------------------------------------------------------------------------
  res.json({
    // ── Global (backward-compat) ────────────────────────────────────────────
    date: dateParam,
    run_status: r?.status ?? null,
    executive_summary: s.executiveSummary ?? "",
    sections: {
      working_well:                 normalizeSection(s.workingWell),
      to_improve:                   normalizeSection(s.toImprove),
      risks:                        normalizeSection(s.risks),
      closing_rate_recommendations: normalizeSection(s.closingRateRecommendations),
    },

    // ── Per-operator (enhanced) ─────────────────────────────────────────────
    operators: operators.map(op => {
      const team = getTeam(op.operatorName);
      const normName = normalizeOperatorName(op.operatorName);
      return {
        name: op.operatorName,
        team,
        overview: op.paragraphOverview ?? "",
        strengths: op.strengths ?? [],
        blind_spots: op.blindSpots ?? [],
        coaching: op.coachingRecommendations ?? [],
        // followups only for 360; Vida intentionally omitted
        ...(team === "360"
          ? { followups: followupsByNormName.get(normName) ?? [] }
          : {}),
      };
    }),

    // ── Stats ───────────────────────────────────────────────────────────────
    stats: {
      total_conversations: stats.total,
      with_follow_up: stats.withFollowUp,
      operators_analyzed: operators.length,
    },

    // ── Per-team summaries (new) ─────────────────────────────────────────────
    ...(teamsCache ? { teams: teamsCache } : {}),
  });
});

export default router;
