import { describe, expect, it } from "vitest";
import { groupIntoConversations } from "./conversations.js";
import type { RingoverCall } from "@workspace/ringover";

const ALFA = "351215832338";
const REAL_NOTE =
  "Cliente ligou interessado em cotação TVDE. Operador apresentou opções da Tranquilidade e da Lusitania. Cliente vai pensar e responde até quinta-feira.";

function call(o: Partial<RingoverCall> & { cdr_id: number | string }): RingoverCall {
  return {
    is_answered: true,
    note: REAL_NOTE,
    direction: "in",
    from_number: "351911234567",
    to_number: ALFA,
    user: { user_id: 100, firstname: "Marina", lastname: "S.", team_id: 17922751 },
    duration: 180,
    start_time: "2026-04-30T10:00:00Z",
    record: "https://recordings.example/abc.mp3",
    ...o,
  };
}

describe("groupIntoConversations", () => {
  it("returns an empty array when given no calls", () => {
    expect(groupIntoConversations([])).toEqual([]);
  });

  it("creates a single-leg conversation from one inbound call", () => {
    const out = groupIntoConversations([call({ cdr_id: 1 })]);
    expect(out).toHaveLength(1);
    expect(out[0].customerPhone).toBe("351911234567");
    expect(out[0].callIds).toEqual(["1"]);
    expect(out[0].legCount).toBe(1);
    expect(out[0].isMultiLeg).toBe(false);
    expect(out[0].agentName).toBe("Marina S.");
    expect(out[0].recordingUrls).toEqual(["https://recordings.example/abc.mp3"]);
    expect(out[0].durationSec).toBe(180);
  });

  it("merges inbound + outbound for the same customer into a multi-leg conversation", () => {
    const out = groupIntoConversations([
      call({ cdr_id: 1, direction: "in", start_time: "2026-04-30T10:00:00Z" }),
      call({
        cdr_id: 2,
        direction: "out",
        from_number: ALFA,
        to_number: "351911234567",
        start_time: "2026-04-30T14:00:00Z",
        user: { user_id: 200, firstname: "Tiago", lastname: "F." },
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].legCount).toBe(2);
    expect(out[0].isMultiLeg).toBe(true);
    expect(out[0].callIds).toEqual(["1", "2"]);
    expect(out[0].agentsInvolved.map((a) => a.name).sort()).toEqual(["Marina S.", "Tiago F."]);
  });

  it("keeps different customers as separate conversations", () => {
    const out = groupIntoConversations([
      call({ cdr_id: 1, from_number: "351911111111" }),
      call({ cdr_id: 2, from_number: "351922222222" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.customerPhone).sort()).toEqual(["351911111111", "351922222222"]);
  });

  it("drops unanalyzable calls (unanswered, short note)", () => {
    const out = groupIntoConversations([
      call({ cdr_id: 1, is_answered: false }), // unanswered
      call({ cdr_id: 2, note: "tt" }), // too short
      call({ cdr_id: 4 }), // OK
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].callIds).toEqual(["4"]);
  });

  it("sorts legs chronologically and conversations by earliest leg", () => {
    const out = groupIntoConversations([
      call({ cdr_id: 11, from_number: "351933333333", start_time: "2026-04-30T15:00:00Z" }),
      call({ cdr_id: 1, from_number: "351911234567", start_time: "2026-04-30T09:00:00Z" }),
      call({ cdr_id: 2, from_number: "351911234567", start_time: "2026-04-30T11:00:00Z", direction: "out", to_number: "351911234567", user: { user_id: 100, firstname: "Marina", lastname: "S." } }),
    ]);
    expect(out.map((c) => c.customerPhone)).toEqual(["351911234567", "351933333333"]);
    expect(out[0].callIds).toEqual(["1", "2"]);
  });
});
