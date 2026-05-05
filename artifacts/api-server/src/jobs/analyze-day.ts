import { eq, and } from "drizzle-orm";
import {
  db,
  conversationsTable,
  runsTable,
  dailySummariesTable,
  operatorSummariesTable,
  casesTable,
  caseTicketsTable,
  caseCallsTable,
} from "@workspace/db";
import { OpenRouterClient } from "@workspace/openrouter";
import { RingoverClient } from "@workspace/ringover";
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { groupIntoConversations, type GroupedConversation } from "../grouping/conversations.js";
import { analyzeConversation } from "../analysis/analyzer.js";
import {
  generateDailySummary,
  type AnalyzedConversationRef,
} from "../analysis/summarizer.js";
import { bucketByAgent, generateAgentSummary } from "../analysis/agent-summarizer.js";
import { analyzeCase } from "../analysis/case-analyzer.js";
import { lisbonDayBoundsISO } from "../lib/dates.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { env } from "../lib/env.js";
import { publishRunEvent } from "./bus.js";
import { syncTickets } from "./sync-tickets.js";
import { buildCases, CASE_PROXIMITY_DAYS } from "../cases/linker.js";
import type { ConversationAnalysis } from "../analysis/schema.js";

export interface AnalyzeDayOptions {
  date: string; // YYYY-MM-DD
  force?: boolean;
}

/**
 * Full daily orchestrator: fetch → group → upsert → analyze (cached) →
 * daily summary → per-agent summaries. Updates the `runs` row and emits SSE
 * events as it goes.
 */
export async function analyzeDay(opts: AnalyzeDayOptions): Promise<void> {
  const { date, force = false } = opts;
  const cfg = env();

  if (!cfg.RINGOVER_API_KEY) throw new Error("RINGOVER_API_KEY not configured");
  if (!cfg.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

  const ringover = new RingoverClient({ apiKey: cfg.RINGOVER_API_KEY });
  const openrouter = new OpenRouterClient({
    apiKey: cfg.OPENROUTER_API_KEY,
    appReferer: cfg.PUBLIC_APP_URL,
    appTitle: "Alfaseguros Supervisor Virtual",
  });
  const model = cfg.OPENROUTER_MODEL;

  await db
    .update(runsTable)
    .set({ status: "running", errorMessage: null })
    .where(eq(runsTable.date, date));

  try {
    const [start, end] = lisbonDayBoundsISO(date);
    const calls = await ringover.listCallsBetween(start, end);

    const groups = groupIntoConversations(calls);

    // Upsert conversation rows; remember row ids so we can save analysis later.
    const rowIdByPhone = new Map<string, number>();
    for (const g of groups) {
      const existing = await db
        .select()
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.runDate, date),
            eq(conversationsTable.customerPhone, g.customerPhone),
          ),
        );

      if (existing.length > 0) {
        const row = existing[0];
        await db
          .update(conversationsTable)
          .set({
            callIds: g.callIds,
            agentId: g.agentId,
            agentName: g.agentName,
            durationSec: g.durationSec,
            recordingUrls: g.recordingUrls,
            ...(force ? { analysisJson: null, costUsd: null } : {}),
          })
          .where(eq(conversationsTable.id, row.id));
        rowIdByPhone.set(g.customerPhone, row.id);
      } else {
        const [inserted] = await db
          .insert(conversationsTable)
          .values({
            runDate: date,
            customerPhone: g.customerPhone,
            callIds: g.callIds,
            agentId: g.agentId,
            agentName: g.agentName,
            durationSec: g.durationSec,
            recordingUrls: g.recordingUrls,
          })
          .returning();
        rowIdByPhone.set(g.customerPhone, inserted.id);
      }
    }

    await db
      .update(runsTable)
      .set({
        totalConversations: groups.length,
        analyzedConversations: 0,
        totalCostUsd: "0",
      })
      .where(eq(runsTable.date, date));

    publishRunEvent({ type: "run:start", date, total: groups.length });

    if (groups.length === 0) {
      await db
        .update(runsTable)
        .set({ status: "completed", analyzedConversations: 0, totalCostUsd: "0" })
        .where(eq(runsTable.date, date));
      publishRunEvent({ type: "run:done", date, analyzed: 0, costUsd: 0 });
      return;
    }

    // Analyze each conversation (skip cached unless force)
    const analyzed: Array<
      AnalyzedConversationRef & {
        rowId: number;
        agentId: string | null;
        agentsInvolved: { id: string; name: string }[];
      }
    > = [];
    let totalCost = 0;
    let analyzedCount = 0;

    await mapWithConcurrency(groups, cfg.ANALYSIS_CONCURRENCY, async (conv) => {
      const rowId = rowIdByPhone.get(conv.customerPhone);
      if (rowId == null) return;
      publishRunEvent({
        type: "conv:start",
        date,
        conversationId: rowId,
        customerPhone: conv.customerPhone,
      });

      // Cache check
      if (!force) {
        const [row] = await db
          .select()
          .from(conversationsTable)
          .where(eq(conversationsTable.id, rowId));
        if (row?.analysisJson != null) {
          const cached = row.analysisJson as ConversationAnalysis;
          analyzed.push({
            rowId,
            customerPhone: conv.customerPhone,
            agentName: conv.agentName,
            legCount: conv.legCount,
            durationSec: conv.durationSec,
            analysis: cached,
            agentId: conv.agentId,
            agentsInvolved: conv.agentsInvolved,
          });
          analyzedCount += 1;
          publishRunEvent({ type: "conv:done", date, conversationId: rowId, costUsd: 0 });
          return;
        }
      }

      try {
        const outcome = await analyzeConversation(conv, { client: openrouter, model });
        if (outcome.ok) {
          totalCost += outcome.cost.costUsd;
          analyzedCount += 1;
          await db
            .update(conversationsTable)
            .set({
              analysisJson: outcome.analysis,
              costUsd: outcome.cost.costUsd.toFixed(6),
            })
            .where(eq(conversationsTable.id, rowId));
          analyzed.push({
            rowId,
            customerPhone: conv.customerPhone,
            agentName: conv.agentName,
            legCount: conv.legCount,
            durationSec: conv.durationSec,
            analysis: outcome.analysis,
            agentId: conv.agentId,
            agentsInvolved: conv.agentsInvolved,
          });
          publishRunEvent({
            type: "conv:done",
            date,
            conversationId: rowId,
            costUsd: outcome.cost.costUsd,
          });
        } else {
          totalCost += outcome.cost.costUsd;
          publishRunEvent({
            type: "conv:error",
            date,
            conversationId: rowId,
            message: outcome.error,
          });
        }
      } catch (err) {
        publishRunEvent({
          type: "conv:error",
          date,
          conversationId: rowId,
          message: (err as Error).message,
        });
      }

      await db
        .update(runsTable)
        .set({
          analyzedConversations: analyzedCount,
          totalCostUsd: totalCost.toFixed(6),
        })
        .where(eq(runsTable.date, date));
    });

    // Phase 2A — sync Zoho Desk tickets, build cross-channel cases, analyze each.
    // Gated on Zoho credentials being configured; otherwise the run stays
    // call-only and the Pipeline view will simply be empty.
    if (
      cfg.ZOHO_DESK_CLIENT_ID &&
      cfg.ZOHO_DESK_CLIENT_SECRET &&
      cfg.ZOHO_DESK_REFRESH_TOKEN &&
      cfg.ZOHO_DESK_ORG_ID
    ) {
      try {
        const auth = new ZohoAuth({
          clientId: cfg.ZOHO_DESK_CLIENT_ID,
          clientSecret: cfg.ZOHO_DESK_CLIENT_SECRET,
          refreshToken: cfg.ZOHO_DESK_REFRESH_TOKEN,
        });
        const desk = new ZohoDeskClient({ auth, orgId: cfg.ZOHO_DESK_ORG_ID });

        const dayStart = new Date(`${date}T00:00:00Z`);
        const winFrom = new Date(dayStart.getTime() - CASE_PROXIMITY_DAYS * 86_400_000);
        const winTo = new Date(dayStart.getTime() + 86_400_000);

        const sync = await syncTickets(desk, winFrom, winTo);

        const linkerInput = analyzed.map((a) => ({
          rowId: a.rowId,
          customerPhone: a.customerPhone,
          callIds: [],
          agentId: a.agentId,
          agentName: a.agentName,
          agentsInvolved: a.agentsInvolved,
          durationSec: a.durationSec,
          recordingUrls: [],
          legCount: a.legCount,
          isMultiLeg: a.legCount > 1,
          startTime: null,
          legs: [],
        }));
        const cases = buildCases({
          conversations: linkerInput,
          tickets: sync.tickets,
          comments: sync.comments,
        });

        await mapWithConcurrency(cases, cfg.ANALYSIS_CONCURRENCY, async (c) => {
          // Persist the case shell first; analysis fills in afterwards.
          const shell = {
            id: c.id,
            customerPhone: c.customerPhone,
            phoneFingerprint: c.phoneFingerprint,
            customerName: c.customerName,
            productName: c.productName,
            primaryAgentId: c.primaryAgentId,
            primaryAgentName: c.primaryAgentName,
            firstActivityAt: c.firstActivityAt ? new Date(c.firstActivityAt) : null,
            lastActivityAt: c.lastActivityAt ? new Date(c.lastActivityAt) : null,
            timelineJson: c.legs,
            legCount: c.legs.length,
          };
          await db
            .insert(casesTable)
            .values(shell)
            .onConflictDoUpdate({ target: casesTable.id, set: shell });

          // Refresh the link tables (idempotent: clear + re-insert).
          await db.delete(caseTicketsTable).where(eq(caseTicketsTable.caseId, c.id));
          if (c.ticketIds.length > 0) {
            await db
              .insert(caseTicketsTable)
              .values(c.ticketIds.map((tid) => ({ caseId: c.id, ticketId: tid })));
          }
          await db.delete(caseCallsTable).where(eq(caseCallsTable.caseId, c.id));
          if (c.conversationIds.length > 0) {
            await db
              .insert(caseCallsTable)
              .values(c.conversationIds.map((cid) => ({ caseId: c.id, conversationId: cid })));
          }

          if (force === false) {
            const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, c.id));
            if (existing?.analysisJson != null) return;
          }

          if (c.legs.length === 0) return;
          const outcome = await analyzeCase(c, { client: openrouter, model });
          if (outcome.ok) {
            totalCost += outcome.cost.costUsd;
            await db
              .update(casesTable)
              .set({
                analysisJson: outcome.analysis,
                costUsd: outcome.cost.costUsd.toFixed(6),
              })
              .where(eq(casesTable.id, c.id));
          }
        });
      } catch (err) {
        // Phase 2A failures shouldn't kill the whole run — Phase 1 results
        // are already in the DB. Surface via SSE and continue.
        publishRunEvent({
          type: "run:error",
          date,
          message: `Phase 2A (cases) failed: ${(err as Error).message}`,
        });
      }
    }

    // Daily executive summary
    if (analyzed.length > 0) {
      const summaryOutcome = await generateDailySummary(analyzed, date, {
        client: openrouter,
        model,
      });
      if (summaryOutcome.ok) {
        totalCost += summaryOutcome.cost.costUsd;
        await db
          .insert(dailySummariesTable)
          .values({
            date,
            executiveSummary: summaryOutcome.summary.executiveSummary,
            workingWell: summaryOutcome.summary.workingWell,
            toImprove: summaryOutcome.summary.toImprove,
            risks: summaryOutcome.summary.risks,
            closingRateRecommendations: summaryOutcome.summary.closingRateRecommendations,
            automationOpportunities: summaryOutcome.summary.automationOpportunities,
          })
          .onConflictDoUpdate({
            target: dailySummariesTable.date,
            set: {
              executiveSummary: summaryOutcome.summary.executiveSummary,
              workingWell: summaryOutcome.summary.workingWell,
              toImprove: summaryOutcome.summary.toImprove,
              risks: summaryOutcome.summary.risks,
              closingRateRecommendations: summaryOutcome.summary.closingRateRecommendations,
              automationOpportunities: summaryOutcome.summary.automationOpportunities,
            },
          });
        publishRunEvent({
          type: "summary:done",
          date,
          costUsd: summaryOutcome.cost.costUsd,
        });
      }
    }

    // Per-operator coaching
    let agentsCount = 0;
    let agentsCost = 0;
    if (analyzed.length > 0) {
      const buckets = bucketByAgent(analyzed);
      // Reset operator summaries for this date so renames/removals don't linger
      await db.delete(operatorSummariesTable).where(eq(operatorSummariesTable.date, date));
      for (const bucket of buckets) {
        const outcome = await generateAgentSummary(bucket, date, {
          client: openrouter,
          model,
        });
        if (outcome.ok) {
          agentsCost += outcome.cost.costUsd;
          totalCost += outcome.cost.costUsd;
          await db.insert(operatorSummariesTable).values({
            date,
            operatorId: bucket.agentId,
            operatorName: bucket.agentName,
            paragraphOverview: outcome.summary.paragraphOverview,
            strengths: outcome.summary.strengths,
            blindSpots: outcome.summary.blindSpots,
            closingRateObservations: outcome.summary.closingRateObservations,
            coachingRecommendations: outcome.summary.coachingRecommendations,
          });
          agentsCount += 1;
        }
      }
      publishRunEvent({ type: "agents:done", date, count: agentsCount, costUsd: agentsCost });
    }

    await db
      .update(runsTable)
      .set({
        status: "completed",
        analyzedConversations: analyzedCount,
        totalCostUsd: totalCost.toFixed(6),
      })
      .where(eq(runsTable.date, date));

    publishRunEvent({ type: "run:done", date, analyzed: analyzedCount, costUsd: totalCost });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runsTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(runsTable.date, date));
    publishRunEvent({ type: "run:error", date, message });
    throw err;
  }
}
