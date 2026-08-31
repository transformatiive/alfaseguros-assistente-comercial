import { describe, it, expect } from "vitest";
import {
  shapeFollowUps,
  type ConversationForFollowUp,
  type ShapeFollowUpsInput,
} from "./followups-shape.js";

/**
 * `/api/followups/pending` is consumed by a live n8n workflow that creates
 * Zoho Desk tasks. These tests pin the payload byte for byte against a fixture
 * captured from the pre-extraction route, so a refactor cannot quietly rename
 * a field, drop a null, or reorder the list.
 */

function conv(over: Partial<ConversationForFollowUp> & { id: number }): ConversationForFollowUp {
  return {
    agentId: "23275677",
    customerPhone: "351911111111",
    analysisJson: { followUpNecessario: true, produto: "Auto", followUpDescricao: "Enviar proposta" },
    updatedAt: new Date("2026-08-28T09:00:00Z"),
    ...over,
  };
}

function input(over: Partial<ShapeFollowUpsInput> = {}): ShapeFollowUpsInput {
  return {
    conversations: [conv({ id: 1 })],
    ackedIds: new Set(),
    vidaIds: new Set([23185416]),
    excludedProducts: new Set(["tvde", "caravela"]),
    emailMap: new Map([[23275677, "ana@alfaseguros.pt"]]),
    ticketByConvId: new Map([[1, "367662000001234567"]]),
    limit: 100,
    offset: 0,
    ...over,
  };
}

describe("shapeFollowUps — the n8n contract", () => {
  it("emits exactly the fixture captured from the pre-extraction route", () => {
    // Deep-equal on the whole object, not field spot-checks: an added or
    // renamed key fails here, which is the point.
    expect(shapeFollowUps(input())).toEqual({
      pending: [
        {
          id: "conv_1",
          agent_email: "ana@alfaseguros.pt",
          agent_ref: "23275677",
          contact_phone: "351911111111",
          contact_email: null,
          follow_up_descricao: "Enviar proposta",
          follow_up_sla_hours: 24,
          linked_ticket_id: "367662000001234567",
          product: "Auto",
          detected_at: "2026-08-28T09:00:00.000Z",
        },
      ],
      count: 1,
      total: 1,
      offset: 0,
      has_more: false,
    });
  });

  it("keeps the exact key order the route emitted", () => {
    const item = shapeFollowUps(input()).pending[0];
    expect(Object.keys(item)).toEqual([
      "id",
      "agent_email",
      "agent_ref",
      "contact_phone",
      "contact_email",
      "follow_up_descricao",
      "follow_up_sla_hours",
      "linked_ticket_id",
      "product",
      "detected_at",
    ]);
  });

  it("falls back to the standard sentence when there is no description", () => {
    const out = shapeFollowUps(
      input({ conversations: [conv({ id: 1, analysisJson: { produto: "Auto" } })] }),
    );
    expect(out.pending[0].follow_up_descricao).toBe(
      "Follow-up necessário — sem descrição registada.",
    );
  });

  it("nulls an empty phone and an empty product rather than emitting empty strings", () => {
    const out = shapeFollowUps(
      input({
        conversations: [conv({ id: 1, customerPhone: "", analysisJson: { produto: "  " } })],
        ticketByConvId: new Map(),
      }),
    );
    expect(out.pending[0].contact_phone).toBeNull();
    expect(out.pending[0].product).toBeNull();
    expect(out.pending[0].linked_ticket_id).toBeNull();
  });

  it("keeps agent_ref even when the email map has no entry", () => {
    const out = shapeFollowUps(
      input({ conversations: [conv({ id: 1, agentId: "99999999" })], emailMap: new Map() }),
    );
    expect(out.pending[0].agent_email).toBeNull();
    expect(out.pending[0].agent_ref).toBe("99999999");
  });

  it("excludes acked, Vida-team and excluded-product conversations", () => {
    const out = shapeFollowUps(
      input({
        conversations: [
          conv({ id: 1 }),
          conv({ id: 2 }),
          conv({ id: 3, agentId: "23185416" }),
          conv({
            id: 4,
            analysisJson: { produto: "TVDE", followUpDescricao: "x" },
          }),
        ],
        ackedIds: new Set(["conv_2"]),
        ticketByConvId: new Map(),
      }),
    );
    expect(out.pending.map((p) => p.id)).toEqual(["conv_1"]);
    expect(out.total).toBe(1);
  });

  it("paginates with has_more, and offset is echoed back", () => {
    const conversations = [1, 2, 3].map((id) => conv({ id }));
    const first = shapeFollowUps(input({ conversations, limit: 2, offset: 0, ticketByConvId: new Map() }));
    expect(first.pending.map((p) => p.id)).toEqual(["conv_1", "conv_2"]);
    expect(first).toMatchObject({ count: 2, total: 3, offset: 0, has_more: true });

    const second = shapeFollowUps(input({ conversations, limit: 2, offset: 2, ticketByConvId: new Map() }));
    expect(second.pending.map((p) => p.id)).toEqual(["conv_3"]);
    expect(second).toMatchObject({ count: 1, total: 3, offset: 2, has_more: false });
  });
});

describe("shapeFollowUps — the agent-panel filter", () => {
  it("returns every agent when agentRef is omitted, which is what n8n gets", () => {
    const out = shapeFollowUps(
      input({
        conversations: [conv({ id: 1, agentId: "23275677" }), conv({ id: 2, agentId: "23275678" })],
        ticketByConvId: new Map(),
      }),
    );
    expect(out.pending.map((p) => p.agent_ref)).toEqual(["23275677", "23275678"]);
  });

  it("returns only that agent when agentRef is given", () => {
    const out = shapeFollowUps(
      input({
        conversations: [conv({ id: 1, agentId: "23275677" }), conv({ id: 2, agentId: "23275678" })],
        agentRef: "23275678",
        ticketByConvId: new Map(),
      }),
    );
    expect(out.pending.map((p) => p.id)).toEqual(["conv_2"]);
    expect(out.total).toBe(1);
  });

  it("returns nothing for an agent with no follow-ups, rather than everything", () => {
    const out = shapeFollowUps(input({ agentRef: "00000000", ticketByConvId: new Map() }));
    expect(out.pending).toEqual([]);
    expect(out.total).toBe(0);
  });
});
