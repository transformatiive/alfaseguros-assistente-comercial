import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  caseCallsTable,
  caseTicketsTable,
  followUpAcksTable,
} from "@workspace/db";
import { VIDA_AGENT_IDS as VIDA_CONST } from "@workspace/ringover";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bearer-token middleware — separate from session auth (used by n8n)
// ---------------------------------------------------------------------------
const requireToken: RequestHandler = (req, res, next) => {
  const token = env().FOLLOWUP_API_TOKEN;
  if (!token) {
    res.status(503).json({ error: "FOLLOWUP_API_TOKEN not configured on server" });
    return;
  }
  const header = req.headers["authorization"] ?? "";
  if (header !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// ---------------------------------------------------------------------------
// Config helpers (re-evaluated per request so env changes take effect)
// ---------------------------------------------------------------------------
function buildVidaIds(): Set<number> {
  const s = new Set<number>(VIDA_CONST);
  for (const p of (env().VIDA_AGENT_IDS ?? "").split(",")) {
    const n = parseInt(p.trim(), 10);
    if (!isNaN(n)) s.add(n);
  }
  return s;
}

function buildEmailMap(): Map<number, string> {
  try {
    const parsed = JSON.parse(env().AGENT_EMAIL_MAP ?? "{}") as Record<string, string>;
    return new Map(Object.entries(parsed).map(([k, v]) => [parseInt(k, 10), v]));
  } catch {
    return new Map();
  }
}

function buildExcludedProducts(): Set<string> {
  return new Set(
    (env().FOLLOWUP_EXCLUDE_PRODUCTS ?? "TVDE,Caravela")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// GET /api/followups/pending
// Read-only. Returns follow-up promises not yet emitted to Zoho Desk.
//
// Query params:
//   since  — ISO 8601 datetime. Only return items where detected_at >= since.
//             Strongly recommended to avoid backlog. E.g. ?since=2026-06-01T00:00:00Z
//   limit  — max items per page (default 100, max 500)
//   offset — skip N items (default 0); use with limit for pagination
// ---------------------------------------------------------------------------
router.get("/followups/pending", requireToken, async (req, res): Promise<void> => {
  // --- Parse query params ---
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
  const limit = isNaN(limitRaw) || limitRaw <= 0 ? 100 : Math.min(limitRaw, 500);

  const offsetRaw = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
  const offset = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;

  let sinceDate: Date | undefined;
  if (typeof req.query.since === "string" && req.query.since) {
    const d = new Date(req.query.since);
    if (!isNaN(d.getTime())) sinceDate = d;
  }

  const vidaIds = buildVidaIds();
  const emailMap = buildEmailMap();
  const excludedProducts = buildExcludedProducts();

  // 1. Conversations with followUpNecessario = true, optionally filtered by date
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        sql`${conversationsTable.analysisJson}->>'followUpNecessario' = 'true'`,
        sinceDate ? gte(conversationsTable.updatedAt, sinceDate) : undefined,
      ),
    );

  if (conversations.length === 0) {
    res.json({ pending: [], count: 0, total: 0, offset, has_more: false });
    return;
  }

  const allConvIds = conversations.map((c) => c.id);

  // 2. Already-acked follow-up IDs
  const acks = await db
    .select({ followUpId: followUpAcksTable.followUpId })
    .from(followUpAcksTable)
    .where(inArray(followUpAcksTable.conversationId, allConvIds));
  const ackedIds = new Set(acks.map((a) => a.followUpId));

  // 3. Apply JS filters (vida, products, acked) to determine full filtered set
  type FilteredConv = (typeof conversations)[number] & {
    _agentNumId: number;
    _produto: string;
    _followUpDescricao: string;
  };

  const filtered: FilteredConv[] = [];
  for (const conv of conversations) {
    const followUpId = `conv_${conv.id}`;
    if (ackedIds.has(followUpId)) continue;

    const agentNumId = conv.agentId != null ? parseInt(conv.agentId, 10) : NaN;
    if (!isNaN(agentNumId) && vidaIds.has(agentNumId)) continue;

    const a = (conv.analysisJson ?? {}) as Record<string, unknown>;
    const produto = typeof a.produto === "string" ? a.produto.trim() : "";
    if (produto && excludedProducts.has(produto.toLowerCase())) continue;

    const followUpDescricao =
      typeof a.followUpDescricao === "string" && a.followUpDescricao.trim()
        ? a.followUpDescricao.trim()
        : "Follow-up necessário — sem descrição registada.";

    filtered.push({ ...conv, _agentNumId: agentNumId, _produto: produto, _followUpDescricao: followUpDescricao });
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  // 4. Batch load linked ticket IDs for this page only
  const pageConvIds = page.map((c) => c.id);
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

  // 5. Build response
  const pending = page.map((conv) => {
    const agentEmail =
      (!isNaN(conv._agentNumId) && emailMap.get(conv._agentNumId)) || null;

    return {
      id: `conv_${conv.id}`,
      agent_email: agentEmail,
      /** Raw Ringover agent ID — always present so n8n can route unmapped agents */
      agent_ref: conv.agentId ?? null,
      contact_phone: conv.customerPhone || null,
      contact_email: null,
      follow_up_descricao: conv._followUpDescricao,
      follow_up_sla_hours: 24,
      linked_ticket_id: ticketByConvId.get(conv.id) ?? null,
      product: conv._produto || null,
      detected_at: conv.updatedAt.toISOString(),
    };
  });

  // 6. Log email coverage for observability
  const withEmail = pending.filter((p) => p.agent_email !== null).length;
  const withoutEmail = pending.length - withEmail;
  if (withoutEmail > 0) {
    req.log.warn(
      { total, page_size: pending.length, with_email: withEmail, without_email: withoutEmail, sinceDate },
      "followups/pending: some items have no resolved agent_email",
    );
  } else {
    req.log.info(
      { total, page_size: pending.length, with_email: withEmail, sinceDate },
      "followups/pending: all items have agent_email resolved",
    );
  }

  res.json({
    pending,
    count: pending.length,
    total,
    offset,
    has_more: hasMore,
  });
});

// ---------------------------------------------------------------------------
// POST /api/followups/:id/ack
// n8n calls this after creating the Desk Task. Idempotent.
// ---------------------------------------------------------------------------
router.post("/followups/:id/ack", requireToken, async (req, res): Promise<void> => {
  const followUpId = String(req.params.id);
  const { desk_task_id, emitted_at, dedup } = req.body as {
    desk_task_id?: string;
    emitted_at?: string;
    dedup?: string;
  };

  if (!desk_task_id) {
    res.status(400).json({ error: "desk_task_id é obrigatório" });
    return;
  }

  const match = /^conv_(\d+)$/.exec(followUpId);
  if (!match) {
    res.status(404).json({ error: "Follow-up não encontrado" });
    return;
  }
  const convId = parseInt(match[1], 10);

  const [conv] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId));

  if (!conv) {
    res.status(404).json({ error: "Follow-up não encontrado" });
    return;
  }

  const emittedAt = emitted_at ? new Date(emitted_at) : new Date();

  await db
    .insert(followUpAcksTable)
    .values({
      followUpId,
      conversationId: convId,
      deskTaskId: desk_task_id,
      emittedAt,
      dedup: dedup ?? null,
    })
    .onConflictDoUpdate({
      target: followUpAcksTable.followUpId,
      set: {
        deskTaskId: desk_task_id,
        emittedAt,
        dedup: dedup ?? null,
      },
    });

  res.json({ id: followUpId, status: "emitted", desk_task_id });
});

// ---------------------------------------------------------------------------
// POST /api/followups/close-loop
// n8n calls when a Desk Task is completed. Always 200 (prevents retry storms).
// ---------------------------------------------------------------------------
router.post("/followups/close-loop", requireToken, async (req, res): Promise<void> => {
  const { desk_task_id, completed_at, completed_by } = req.body as {
    desk_task_id?: string;
    completed_at?: string;
    completed_by?: string;
  };

  if (!desk_task_id) {
    res.json({ id: null });
    return;
  }

  try {
    const completedAt = completed_at ? new Date(completed_at) : new Date();
    const [ack] = await db
      .update(followUpAcksTable)
      .set({ completedAt, completedBy: completed_by ?? null })
      .where(eq(followUpAcksTable.deskTaskId, desk_task_id))
      .returning({ followUpId: followUpAcksTable.followUpId });

    if (!ack) {
      req.log.warn({ desk_task_id }, "close-loop: desk_task_id not found");
    }

    res.json({ id: ack?.followUpId ?? null });
  } catch (err) {
    logger.warn({ desk_task_id, err }, "close-loop: unexpected error");
    res.json({ id: null });
  }
});

export default router;
