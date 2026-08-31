import { and, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  caseCallsTable,
  caseTicketsTable,
  followUpAcksTable,
} from "@workspace/db";
import { filterFollowUps, shapeFollowUps, type FollowUpsResponse } from "./followups-shape.js";

export * from "./followups-shape.js";

/**
 * Loading for the pending-follow-ups query, extracted from
 * `routes/followups.ts` so the agent panel can reuse it with a per-agent
 * filter. The shaping lives in `followups-shape.ts`, which has no database
 * import so a test can pin the n8n contract without a Postgres.
 */

export interface LoadFollowUpsParams {
  since?: Date;
  limit: number;
  offset: number;
  vidaIds: ReadonlySet<number>;
  excludedProducts: ReadonlySet<string>;
  emailMap: ReadonlyMap<number, string>;
  /** Restrict to one agent's Ringover user_id. Omit for the n8n behaviour. */
  agentRef?: string;
}

/** Load and shape the pending follow-ups. */
export async function loadPendingFollowUps(
  params: LoadFollowUpsParams,
): Promise<FollowUpsResponse> {
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        sql`${conversationsTable.analysisJson}->>'followUpNecessario' = 'true'`,
        params.since ? gte(conversationsTable.updatedAt, params.since) : undefined,
      ),
    );

  if (conversations.length === 0) {
    return { pending: [], count: 0, total: 0, offset: params.offset, has_more: false };
  }

  const acks = await db
    .select({ followUpId: followUpAcksTable.followUpId })
    .from(followUpAcksTable)
    .where(
      inArray(
        followUpAcksTable.conversationId,
        conversations.map((c) => c.id),
      ),
    );
  const ackedIds = new Set(acks.map((a) => a.followUpId));

  // The ticket join is done for the current page only — same as before the
  // extraction. Filtering twice is cheaper than joining tickets for a backlog
  // the caller will not read.
  const base = {
    conversations,
    ackedIds,
    vidaIds: params.vidaIds,
    excludedProducts: params.excludedProducts,
    agentRef: params.agentRef,
  };
  const pageConvIds = filterFollowUps(base)
    .slice(params.offset, params.offset + params.limit)
    .map((f) => f.conv.id);

  const ticketByConvId = new Map<number, string>();
  if (pageConvIds.length > 0) {
    const caseCallRows = await db
      .select({ convId: caseCallsTable.conversationId, caseId: caseCallsTable.caseId })
      .from(caseCallsTable)
      .where(inArray(caseCallsTable.conversationId, pageConvIds));

    const caseIds = [...new Set(caseCallRows.map((r) => r.caseId))];
    if (caseIds.length > 0) {
      const ticketRows = await db
        .select({ caseId: caseTicketsTable.caseId, ticketId: caseTicketsTable.ticketId })
        .from(caseTicketsTable)
        .where(inArray(caseTicketsTable.caseId, caseIds));

      const ticketByCaseId = new Map<string, string>();
      for (const row of ticketRows) {
        if (!ticketByCaseId.has(row.caseId)) ticketByCaseId.set(row.caseId, row.ticketId);
      }
      for (const cc of caseCallRows) {
        if (!ticketByConvId.has(cc.convId)) {
          const t = ticketByCaseId.get(cc.caseId);
          if (t) ticketByConvId.set(cc.convId, t);
        }
      }
    }
  }

  return shapeFollowUps({
    ...base,
    emailMap: params.emailMap,
    ticketByConvId,
    limit: params.limit,
    offset: params.offset,
  });
}
