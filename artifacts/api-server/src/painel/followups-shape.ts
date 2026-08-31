/**
 * Pure shaping for `/api/followups/pending`.
 *
 * Kept in its own module, with **no import of the database client**, so the
 * n8n contract can be pinned by a test without a Postgres. `followups-query.ts`
 * does the loading and delegates the shape to here.
 *
 * **The response shape is a contract with n8n.** An active workflow reads this
 * endpoint and creates Zoho Desk tasks from it. Every field name, every null,
 * and the ordering are preserved exactly as `routes/followups.ts` emitted them
 * before the extraction.
 */

export interface FollowUpItem {
  id: string;
  agent_email: string | null;
  agent_ref: string | null;
  contact_phone: string | null;
  contact_email: null;
  follow_up_descricao: string;
  follow_up_sla_hours: number;
  linked_ticket_id: string | null;
  product: string | null;
  detected_at: string;
}

export interface FollowUpsResponse {
  pending: FollowUpItem[];
  count: number;
  total: number;
  offset: number;
  has_more: boolean;
}

/** Only the conversation fields the shaping actually reads. */
export interface ConversationForFollowUp {
  id: number;
  agentId: string | null;
  customerPhone: string | null;
  analysisJson: unknown;
  updatedAt: Date;
}

export interface ShapeFollowUpsInput {
  conversations: readonly ConversationForFollowUp[];
  ackedIds: ReadonlySet<string>;
  vidaIds: ReadonlySet<number>;
  excludedProducts: ReadonlySet<string>;
  emailMap: ReadonlyMap<number, string>;
  /** conversationId → Desk ticket id, for the current page only. */
  ticketByConvId: ReadonlyMap<number, string>;
  limit: number;
  offset: number;
  /**
   * Ringover user_id to restrict to, as text. Undefined means "every agent",
   * which is what `/api/followups/pending` has always done and must keep doing.
   */
  agentRef?: string;
}

/** Conversations that survive filtering, before pagination. */
export function filterFollowUps(
  input: Pick<
    ShapeFollowUpsInput,
    "conversations" | "ackedIds" | "vidaIds" | "excludedProducts" | "agentRef"
  >,
): { conv: ConversationForFollowUp; agentNumId: number; produto: string; descricao: string }[] {
  const out: {
    conv: ConversationForFollowUp;
    agentNumId: number;
    produto: string;
    descricao: string;
  }[] = [];

  for (const conv of input.conversations) {
    if (input.ackedIds.has(`conv_${conv.id}`)) continue;
    if (input.agentRef !== undefined && conv.agentId !== input.agentRef) continue;

    const agentNumId = conv.agentId != null ? parseInt(conv.agentId, 10) : NaN;
    if (!isNaN(agentNumId) && input.vidaIds.has(agentNumId)) continue;

    const a = (conv.analysisJson ?? {}) as Record<string, unknown>;
    const produto = typeof a.produto === "string" ? a.produto.trim() : "";
    if (produto && input.excludedProducts.has(produto.toLowerCase())) continue;

    const descricao =
      typeof a.followUpDescricao === "string" && a.followUpDescricao.trim()
        ? a.followUpDescricao.trim()
        : "Follow-up necessário — sem descrição registada.";

    out.push({ conv, agentNumId, produto, descricao });
  }
  return out;
}

/** Pure shaping — the exact payload `/api/followups/pending` returns. */
export function shapeFollowUps(input: ShapeFollowUpsInput): FollowUpsResponse {
  const filtered = filterFollowUps(input);
  const total = filtered.length;
  const page = filtered.slice(input.offset, input.offset + input.limit);

  const pending = page.map(({ conv, agentNumId, produto, descricao }) => ({
    id: `conv_${conv.id}`,
    agent_email: (!isNaN(agentNumId) && input.emailMap.get(agentNumId)) || null,
    agent_ref: conv.agentId ?? null,
    contact_phone: conv.customerPhone || null,
    contact_email: null as null,
    follow_up_descricao: descricao,
    follow_up_sla_hours: 24,
    linked_ticket_id: input.ticketByConvId.get(conv.id) ?? null,
    product: produto || null,
    detected_at: conv.updatedAt.toISOString(),
  }));

  return {
    pending,
    count: pending.length,
    total,
    offset: input.offset,
    has_more: input.offset + input.limit < total,
  };
}

