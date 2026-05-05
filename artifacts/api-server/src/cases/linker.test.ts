import { describe, expect, it } from "vitest";
import { buildCases, sanitizeCommentContent } from "./linker.js";
import type { ZohoTicket } from "@workspace/zoho-desk";
import type { GroupedConversation } from "../grouping/conversations.js";

function ticket(o: Partial<ZohoTicket> & { id: string }): ZohoTicket {
  return {
    ticketNumber: o.id,
    subject: "Cotação TVDE",
    status: "Open",
    contact: {
      firstName: "Ana",
      lastName: "Silva",
      phone: "+351 911 234 567",
    },
    createdTime: "2026-04-25T10:00:00Z",
    modifiedTime: "2026-04-25T10:00:00Z",
    closedTime: null,
    ...o,
  };
}

function conv(
  rowId: number,
  customerPhone: string,
  startTime: string,
  legs: GroupedConversation["legs"] = [],
): GroupedConversation & { rowId: number } {
  return {
    rowId,
    customerPhone,
    callIds: [String(rowId)],
    agentId: "100",
    agentName: "Marina",
    agentsInvolved: [{ id: "100", name: "Marina" }],
    durationSec: 180,
    recordingUrls: [],
    legCount: legs.length || 1,
    isMultiLeg: legs.length > 1,
    startTime,
    legs:
      legs.length > 0
        ? legs
        : [
            {
              callId: String(rowId),
              agentId: "100",
              agentName: "Marina",
              direction: "in",
              startTime,
              durationSec: 180,
              ringoverSummary: "Cliente pediu cotação.",
              recordingUrl: null,
            },
          ],
  };
}

describe("buildCases", () => {
  it("links a call to a ticket within ±14 days when fingerprints match", () => {
    const tickets = [ticket({ id: "T1" })];
    const conversations = [conv(1, "351911234567", "2026-04-30T10:00:00Z")];
    const cases = buildCases({ conversations, tickets, comments: [] });

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe("case_t_T1");
    expect(cases[0].conversationIds).toEqual([1]);
    expect(cases[0].ticketIds).toEqual(["T1"]);
    expect(cases[0].customerName).toBe("Ana Silva");
  });

  it("creates an orphan case when no nearby ticket exists", () => {
    const cases = buildCases({
      conversations: [conv(1, "351966666666", "2026-04-30T10:00:00Z")],
      tickets: [],
      comments: [],
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe("case_p_966666666_2026-04-30");
    expect(cases[0].ticketIds).toEqual([]);
    expect(cases[0].conversationIds).toEqual([1]);
  });

  it("does not link a call to a ticket more than 14 days away", () => {
    const tickets = [ticket({ id: "OLD", createdTime: "2026-03-01T10:00:00Z", modifiedTime: "2026-03-01T10:00:00Z" })];
    const cases = buildCases({
      conversations: [conv(1, "351911234567", "2026-04-30T10:00:00Z")],
      tickets,
      comments: [],
    });
    // Two cases: the orphan call-only and the ticket-only.
    expect(cases.map((c) => c.id).sort()).toEqual([
      "case_p_911234567_2026-04-30",
      "case_t_OLD",
    ].sort());
  });

  it("picks the closest matching ticket when multiple are in window", () => {
    const tickets = [
      ticket({ id: "FAR", createdTime: "2026-04-18T10:00:00Z", modifiedTime: "2026-04-18T10:00:00Z" }),
      ticket({ id: "NEAR", createdTime: "2026-04-29T18:00:00Z", modifiedTime: "2026-04-29T18:00:00Z" }),
    ];
    const cases = buildCases({
      conversations: [conv(1, "351911234567", "2026-04-30T10:00:00Z")],
      tickets,
      comments: [],
    });
    const linked = cases.find((c) => c.conversationIds.includes(1));
    expect(linked?.id).toBe("case_t_NEAR");
  });

  it("keeps different customers as separate cases", () => {
    const tickets = [
      ticket({ id: "A", contact: { firstName: "Ana", phone: "+351 911 111 111" } }),
      ticket({ id: "B", contact: { firstName: "Bruno", phone: "+351 922 222 222" } }),
    ];
    const cases = buildCases({ conversations: [], tickets, comments: [] });
    expect(cases.map((c) => c.id).sort()).toEqual(["case_t_A", "case_t_B"]);
  });
});

describe("sanitizeCommentContent", () => {
  it("strips HTML and entities", () => {
    expect(sanitizeCommentContent("<p>Olá <strong>cliente</strong>&nbsp;Ana.</p>"))
      .toBe("Olá cliente Ana.");
  });
  it("truncates over the limit", () => {
    const long = "a".repeat(2000);
    const out = sanitizeCommentContent(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith("…")).toBe(true);
  });
  it("returns '' on null/undefined", () => {
    expect(sanitizeCommentContent(null)).toBe("");
    expect(sanitizeCommentContent(undefined)).toBe("");
  });
});
