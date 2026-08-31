import { phoneFingerprint } from "@workspace/phone";
import { pickCustomerNumber, type RingoverCall } from "@workspace/ringover";

/**
 * "Chamadas por devolver" — inbound calls nobody answered that still owe the
 * customer a call back.
 *
 * This module is deliberately pure: it takes a day's calls and returns rows to
 * upsert. No Ringover client, no database. That is what makes the two rules
 * that actually matter — auto-resolution and attribution — testable without a
 * network or a Postgres.
 */

/** One row to upsert into `devolucoes`, keyed on `ringoverCallId`. */
export interface DevolucaoCandidate {
  ringoverCallId: string;
  data: string;
  ringoverUserId: string | null;
  numeroCliente: string;
  numeroNormalizado: string;
  horaChamada: Date;
  estado: "pendente" | "devolvida";
  resolvidaAt: Date | null;
  resolvidaPor: string | null;
  origem: "auto" | null;
}

function isInbound(call: RingoverCall): boolean {
  return call.direction === "in" || call.direction === "inbound";
}

function isOutbound(call: RingoverCall): boolean {
  return call.direction === "out" || call.direction === "outbound";
}

function callId(call: RingoverCall): string {
  return String(call.cdr_id);
}

function startedAt(call: RingoverCall): Date | null {
  if (!call.start_time) return null;
  const d = new Date(call.start_time);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Agent attribution. A missed inbound call often carries no `user_id` — nobody
 * picked it up, so Ringover has nobody to attribute it to. In that case we fall
 * back to whoever *did* speak to that customer later the same day, because in
 * practice that is the person who owns the relationship. When there is still no
 * candidate the row is left unattributed and surfaces in the supervisor's
 * shared bucket rather than being dropped.
 */
function attributeAgent(
  missed: RingoverCall,
  laterCallsToSameNumber: RingoverCall[],
): string | null {
  const own = missed.user?.user_id ?? missed.user_id;
  if (typeof own === "number") return String(own);
  for (const c of laterCallsToSameNumber) {
    const uid = c.user?.user_id ?? c.user_id;
    if (typeof uid === "number") return String(uid);
  }
  return null;
}

/**
 * Turn a day's Ringover calls into devolução candidates.
 *
 * Rules:
 *  - keep inbound calls with `is_answered !== true`;
 *  - a customer number with no usable fingerprint is skipped — we cannot match
 *    a call back to it, so a row would be permanently pending;
 *  - if any *answered* outbound call to the same fingerprint starts after the
 *    missed call, the row is already `devolvida` with `origem = "auto"`;
 *  - several missed calls from the same number all resolve against the same
 *    later call back. That is correct: one call back settles the debt.
 *
 * `data` is passed in rather than derived per call, because the caller already
 * knows which Lisbon day it fetched — deriving it here would re-introduce a
 * timezone decision in a module that has no business making one.
 */
export function computeDevolucoes(
  calls: readonly RingoverCall[],
  data: string,
): DevolucaoCandidate[] {
  // Answered outbound calls, grouped by customer fingerprint, so resolution is
  // a lookup instead of a scan per missed call.
  const callbacksByFingerprint = new Map<string, RingoverCall[]>();
  for (const c of calls) {
    if (!isOutbound(c)) continue;
    if (c.is_answered !== true) continue;
    const fp = phoneFingerprint(pickCustomerNumber(c));
    if (!fp) continue;
    callbacksByFingerprint.set(fp, [...(callbacksByFingerprint.get(fp) ?? []), c]);
  }

  const out: DevolucaoCandidate[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    if (!isInbound(call)) continue;
    if (call.is_answered === true) continue;

    const id = callId(call);
    if (seen.has(id)) continue; // Ringover can repeat a cdr across pages.

    const numeroCliente = pickCustomerNumber(call);
    const fp = phoneFingerprint(numeroCliente);
    if (!numeroCliente || !fp) continue;

    const hora = startedAt(call);
    if (!hora) continue;

    const later = (callbacksByFingerprint.get(fp) ?? []).filter((c) => {
      const t = startedAt(c);
      return t !== null && t.getTime() > hora.getTime();
    });
    later.sort((a, b) => (startedAt(a)?.getTime() ?? 0) - (startedAt(b)?.getTime() ?? 0));

    const devolvida = later[0];

    seen.add(id);
    out.push({
      ringoverCallId: id,
      data,
      ringoverUserId: attributeAgent(call, later),
      numeroCliente,
      numeroNormalizado: fp,
      horaChamada: hora,
      estado: devolvida ? "devolvida" : "pendente",
      resolvidaAt: devolvida ? startedAt(devolvida) : null,
      resolvidaPor: devolvida ? "auto" : null,
      origem: devolvida ? "auto" : null,
    });
  }

  out.sort((a, b) => a.horaChamada.getTime() - b.horaChamada.getTime());
  return out;
}
