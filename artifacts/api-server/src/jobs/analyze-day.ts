import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  conversationsTable,
  runsTable,
  dailySummariesTable,
  operatorSummariesTable,
  casesTable,
  caseTicketsTable,
  caseCallsTable,
  ticketsTable,
  ticketCommentsTable,
} from "@workspace/db";
import { OpenRouterClient } from "@workspace/openrouter";
import { RingoverClient } from "@workspace/ringover";
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { phoneFingerprint } from "@workspace/phone";
import { groupIntoConversations, type GroupedConversation } from "../grouping/conversations.js";
import { analyzeConversation } from "../analysis/analyzer.js";
import {
  generateDailySummary,
  type AnalyzedConversationRef,
} from "../analysis/summarizer.js";
import type { RelatedTicketForPrompt } from "../analysis/prompts.js";
import { bucketByAgent, generateAgentSummary } from "../analysis/agent-summarizer.js";
import { analyzeCase } from "../analysis/case-analyzer.js";
import { lisbonDayBoundsISO } from "../lib/dates.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
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

      // Serialise legs to plain JSON for storage
      const legsJson = g.legs.map((l) => ({
        callId: l.callId,
        agentName: l.agentName,
        direction: l.direction,
        startTime: l.startTime,
        durationSec: l.durationSec,
        ringoverSummary: l.ringoverSummary,
      }));

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
            legsJson,
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
            legsJson,
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

    // Pre-fetch any existing Zoho Desk tickets + comment threads from the DB
    // (populated by previous Zoho syncs) so the LLM can build a richer,
    // temporally-coherent narrative. On first-ever run this is a no-op.
    const allFingerprints = [
      ...new Set(
        groups
          .map((g) => phoneFingerprint(g.customerPhone))
          .filter((fp): fp is string => !!fp),
      ),
    ];
    const prefetchedTickets = allFingerprints.length > 0
      ? await db.select().from(ticketsTable).where(inArray(ticketsTable.phoneFingerprint, allFingerprints))
      : [];
    const prefetchedTicketIds = prefetchedTickets.map((t) => t.id);
    const prefetchedComments = prefetchedTicketIds.length > 0
      ? await db
          .select()
          .from(ticketCommentsTable)
          .where(inArray(ticketCommentsTable.ticketId, prefetchedTicketIds))
      : [];
    const prefetchedCommentsByTicketId = new Map<string, typeof prefetchedComments>();
    for (const c of prefetchedComments) {
      const list = prefetchedCommentsByTicketId.get(c.ticketId) ?? [];
      list.push(c);
      prefetchedCommentsByTicketId.set(c.ticketId, list);
    }
    const ticketsByFpForPrompt = new Map<string, RelatedTicketForPrompt[]>();
    for (const t of prefetchedTickets) {
      if (!t.phoneFingerprint) continue;
      const list = ticketsByFpForPrompt.get(t.phoneFingerprint) ?? [];
      list.push({
        ticketNumber: t.ticketNumber ?? null,
        subject: t.subject ?? null,
        status: t.status ?? null,
        category: t.category ?? null,
        assigneeName: t.assigneeName ?? null,
        createdTime: t.createdTime ? t.createdTime.toISOString() : null,
        closedTime: t.closedTime ? t.closedTime.toISOString() : null,
        comments: (prefetchedCommentsByTicketId.get(t.id) ?? []).map((c) => ({
          commentedTime: c.commentedTime ? c.commentedTime.toISOString() : null,
          authorType: c.authorType ?? null,
          authorName: c.authorName ?? null,
          channel: c.channel ?? null,
          content: c.contentSanitized,
        })),
      });
      ticketsByFpForPrompt.set(t.phoneFingerprint, list);
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
        const fp = phoneFingerprint(conv.customerPhone);
        const ticketsForPrompt = fp ? (ticketsByFpForPrompt.get(fp) ?? []) : [];
        const outcome = await analyzeConversation(conv, {
          client: openrouter,
          model,
          relatedTickets: ticketsForPrompt.length > 0 ? ticketsForPrompt : undefined,
        });
        if (outcome.ok) {
          totalCost += outcome.cost.costUsd;
          analyzedCount += 1;
          await db
            .update(conversationsTable)
            .set({
              analysisJson: outcome.analysis,
              analysisError: null,
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
          await db
            .update(conversationsTable)
            .set({ analysisError: outcome.error })
            .where(eq(conversationsTable.id, rowId));
          publishRunEvent({
            type: "conv:error",
            date,
            conversationId: rowId,
            message: outcome.error,
          });
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        await db
          .update(conversationsTable)
          .set({ analysisError: errMsg })
          .where(eq(conversationsTable.id, rowId));
        publishRunEvent({
          type: "conv:error",
          date,
          conversationId: rowId,
          message: errMsg,
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

    // Enrich analyzed conversations with related Zoho tickets + comment threads
    // (for daily summary and operator coaching). Re-fetched after Phase 2A so
    // newly synced tickets are included.
    const fingerprints = [
      ...new Set(
        analyzed
          .map((a) => phoneFingerprint(a.customerPhone))
          .filter((fp): fp is string => !!fp),
      ),
    ];
    const relatedTicketRows =
      fingerprints.length > 0
        ? await db
            .select()
            .from(ticketsTable)
            .where(inArray(ticketsTable.phoneFingerprint, fingerprints))
        : [];
    const relatedTicketIds = relatedTicketRows.map((t) => t.id);
    const relatedCommentRows =
      relatedTicketIds.length > 0
        ? await db
            .select()
            .from(ticketCommentsTable)
            .where(inArray(ticketCommentsTable.ticketId, relatedTicketIds))
        : [];
    const enrichCommentsByTicketId = new Map<string, typeof relatedCommentRows>();
    for (const c of relatedCommentRows) {
      const list = enrichCommentsByTicketId.get(c.ticketId) ?? [];
      list.push(c);
      enrichCommentsByTicketId.set(c.ticketId, list);
    }
    const ticketsByFp = new Map<string, typeof relatedTicketRows>();
    for (const t of relatedTicketRows) {
      if (!t.phoneFingerprint) continue;
      const list = ticketsByFp.get(t.phoneFingerprint) ?? [];
      list.push(t);
      ticketsByFp.set(t.phoneFingerprint, list);
    }
    const analyzedEnriched = analyzed.map((a) => {
      const fp = phoneFingerprint(a.customerPhone);
      const tickets = fp ? (ticketsByFp.get(fp) ?? []) : [];
      return {
        ...a,
        relatedTickets: tickets.map((t) => ({
          ticketNumber: t.ticketNumber ?? null,
          subject: t.subject ?? null,
          status: t.status ?? null,
          category: t.category ?? null,
          createdTime: t.createdTime ? t.createdTime.toISOString() : null,
          closedTime: t.closedTime ? t.closedTime.toISOString() : null,
          comments: (enrichCommentsByTicketId.get(t.id) ?? []).map((c) => ({
            commentedTime: c.commentedTime ? c.commentedTime.toISOString() : null,
            authorType: c.authorType ?? null,
            authorName: c.authorName ?? null,
            content: c.contentSanitized,
          })),
        })),
      };
    });

    // Phase 2A — sync Zoho Desk tickets, build cross-channel cases, analyze each.
    // Gated on Zoho credentials being configured; otherwise the run stays
    // call-only and the Pipeline view will simply be empty.
    // Wrapped in a 5-minute timeout so a slow/hung Zoho API can't stall the run.
    const PHASE_2A_TIMEOUT_MS = 5 * 60_000;
    const zohoClientId = cfg.ZOHO_DESK_CLIENT_ID;
    const zohoClientSecret = cfg.ZOHO_DESK_CLIENT_SECRET;
    const zohoRefreshToken = cfg.ZOHO_DESK_REFRESH_TOKEN;
    const zohoOrgId = cfg.ZOHO_DESK_ORG_ID;
    if (zohoClientId && zohoClientSecret && zohoRefreshToken && zohoOrgId) {
      try {
        const phase2aWork = async () => {
          const auth = new ZohoAuth({
            clientId: zohoClientId,
            clientSecret: zohoClientSecret,
            refreshToken: zohoRefreshToken,
          });
          const desk = new ZohoDeskClient({ auth, orgId: zohoOrgId });

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
        };

        const timeoutGuard = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Phase 2A timed out after ${PHASE_2A_TIMEOUT_MS / 1000}s`)),
            PHASE_2A_TIMEOUT_MS,
          ),
        );

        await Promise.race([phase2aWork(), timeoutGuard]);
      } catch (err) {
        // Phase 2A failures shouldn't kill the whole run — Phase 1 results
        // are already in the DB. Surface via SSE and continue.
        logger.warn({ date, err }, "Phase 2A (cases/Zoho) failed or timed out");
        publishRunEvent({
          type: "run:error",
          date,
          message: `Phase 2A (cases) failed: ${(err as Error).message}`,
        });
      }
    }

    // Daily executive summary (enriched with ticket context)
    if (analyzedEnriched.length > 0) {
      const summaryOutcome = await generateDailySummary(analyzedEnriched, date, {
        client: openrouter,
        model,
      });
      if (!summaryOutcome.ok) {
        logger.warn({ date, error: summaryOutcome.error, rawText: summaryOutcome.rawText }, "Daily summary generation failed");
      }
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

    // Per-operator coaching (enriched with ticket context)
    let agentsCount = 0;
    let agentsCost = 0;
    if (analyzedEnriched.length > 0) {
      const buckets = bucketByAgent(analyzedEnriched);
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
        } else {
          logger.warn(
            { date, agentId: bucket.agentId, agentName: bucket.agentName, error: outcome.error, rawText: outcome.rawText?.slice(0, 500) },
            "Agent summary generation failed",
          );
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
