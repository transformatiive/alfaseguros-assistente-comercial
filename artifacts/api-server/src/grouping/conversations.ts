import {
  getAgentUserId,
  isAnalyzable,
  pickCustomerNumber,
  stripGeneratedByAI,
  type RingoverCall,
} from "@workspace/ringover";

export interface ConversationLeg {
  callId: string;
  agentId: string | null;
  agentName: string | null;
  direction: string | null;
  startTime: string | null;
  durationSec: number;
  ringoverSummary: string;
  recordingUrl: string | null;
}

export interface AgentRef {
  id: string;
  name: string;
}

export interface GroupedConversation {
  customerPhone: string;
  callIds: string[];
  /** Primary agent (most-frequent across legs; ties broken by total duration). */
  agentId: string | null;
  agentName: string | null;
  /** All distinct agents that touched the conversation, ordered by leg count desc. */
  agentsInvolved: AgentRef[];
  /** Total duration across all legs, in seconds. */
  durationSec: number;
  /** Distinct recording URLs across legs (preserves first-seen order). */
  recordingUrls: string[];
  legCount: number;
  isMultiLeg: boolean;
  /** Earliest leg start_time (ISO) — used for sorting + UI header. */
  startTime: string | null;
  /** Per-leg detail in chronological order — fed to the analyzer's user message. */
  legs: ConversationLeg[];
}

function callDurationSec(call: RingoverCall): number {
  if (typeof call.incall_duration === "number") return call.incall_duration;
  if (typeof call.total_duration === "number") return call.total_duration;
  if (typeof call.duration === "number") return call.duration;
  return 0;
}

function callRecordingUrl(call: RingoverCall): string | null {
  return call.recording_url ?? call.record ?? null;
}

function callDirection(call: RingoverCall): string | null {
  if (!call.direction) return call.type ?? null;
  return call.direction;
}

function callStartTime(call: RingoverCall): string | null {
  return call.start_time ?? call.answered_time ?? null;
}

function compareStartTime(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function agentNameFromUser(user: RingoverCall["user"]): string | null {
  if (!user) return null;
  const first = user.firstname ?? "";
  const last = user.lastname ?? "";
  const full = `${first} ${last}`.trim();
  return full || user.email || null;
}

function callToLeg(call: RingoverCall): ConversationLeg {
  const agentIdNum = getAgentUserId(call);
  return {
    callId: String(call.cdr_id),
    agentId: agentIdNum != null ? String(agentIdNum) : null,
    agentName: agentNameFromUser(call.user ?? null),
    direction: callDirection(call),
    startTime: callStartTime(call),
    durationSec: callDurationSec(call),
    ringoverSummary: call.note ? stripGeneratedByAI(call.note) : "",
    recordingUrl: callRecordingUrl(call),
  };
}

/**
 * Group analyzable Ringover calls into customer-level conversations.
 *
 * Rules (per HANDOVER §1 + canonical spec):
 *  - Calls failing {@link isAnalyzable} are dropped silently.
 *  - Calls with no resolvable customer number are dropped.
 *  - Calls with the same `customerPhone` (digits-only fingerprint) form one conversation,
 *    regardless of direction or which agent picked up.
 *  - Within each conversation, legs are sorted chronologically by `start_time`.
 *  - Conversations are returned ordered by their earliest leg's `start_time`.
 */
export function groupIntoConversations(calls: RingoverCall[]): GroupedConversation[] {
  const groups = new Map<string, RingoverCall[]>();
  for (const call of calls) {
    if (!isAnalyzable(call)) continue;
    const customer = pickCustomerNumber(call);
    if (!customer) continue;
    const bucket = groups.get(customer);
    if (bucket) {
      bucket.push(call);
    } else {
      groups.set(customer, [call]);
    }
  }

  const conversations: GroupedConversation[] = [];
  for (const [customerPhone, bucket] of groups) {
    const legs = bucket
      .map(callToLeg)
      .sort((a, b) => compareStartTime(a.startTime, b.startTime));

    const agentStats = new Map<string, { name: string; count: number; duration: number }>();
    for (const leg of legs) {
      if (leg.agentId == null) continue;
      const existing = agentStats.get(leg.agentId);
      if (existing) {
        existing.count += 1;
        existing.duration += leg.durationSec;
        if (!existing.name && leg.agentName) existing.name = leg.agentName;
      } else {
        agentStats.set(leg.agentId, {
          name: leg.agentName ?? "",
          count: 1,
          duration: leg.durationSec,
        });
      }
    }

    const agentsInvolved: AgentRef[] = [...agentStats.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].duration - a[1].duration)
      .map(([id, info]) => ({ id, name: info.name }));

    const primary = agentsInvolved[0] ?? null;

    const recordingUrls: string[] = [];
    const seenUrls = new Set<string>();
    for (const leg of legs) {
      if (leg.recordingUrl && !seenUrls.has(leg.recordingUrl)) {
        recordingUrls.push(leg.recordingUrl);
        seenUrls.add(leg.recordingUrl);
      }
    }

    const durationSec = legs.reduce((sum, l) => sum + l.durationSec, 0);

    conversations.push({
      customerPhone,
      callIds: legs.map((l) => l.callId),
      agentId: primary?.id ?? null,
      agentName: primary?.name || null,
      agentsInvolved,
      durationSec,
      recordingUrls,
      legCount: legs.length,
      isMultiLeg: legs.length > 1,
      startTime: legs[0]?.startTime ?? null,
      legs,
    });
  }

  conversations.sort((a, b) => compareStartTime(a.startTime, b.startTime));
  return conversations;
}
