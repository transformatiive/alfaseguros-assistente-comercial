import type { ZohoTicket } from "@workspace/zoho-desk";

export type OutcomeStatus = "won" | "lost" | "open" | "unknown";

export interface Outcome {
  status: OutcomeStatus;
  reason: string;
}

/**
 * Classify a Zoho Desk ticket as won / lost / open / unknown by reading its
 * custom fields. **Currently a stub** — the real Alfaseguros mapping is
 * blocked on a probe of live tickets (HANDOVER §5).
 *
 * Order matters: the first rule that matches wins. When no rule fits, return
 * `unknown` with a reason explaining what was missing — we deliberately never
 * guess outcomes.
 */
export function classifyOutcome(ticket: ZohoTicket): Outcome {
  const cf = (ticket.cf ?? {}) as Record<string, unknown>;
  const status = (ticket.status ?? "").trim();
  const statusType = (ticket.statusType ?? "").trim().toLowerCase();
  const isClosed = statusType === "closed" || /closed|resolved|fechad/i.test(status);

  // --- Strawman rules. Replace these with real cf_* mappings after the probe. ---

  // 1. Apólice emitida = Sim → won
  const apolice = stringValue(cf.cf_apolice_emitida ?? cf.cf_Apolice_Emitida);
  if (apolice && /^sim|true|y(es)?$/i.test(apolice)) {
    return { status: "won", reason: `cf_apolice_emitida = "${apolice}"` };
  }

  // 2. Motivo perda preenchido → lost
  const motivoPerda = stringValue(cf.cf_motivo_perda ?? cf.cf_Motivo_Perda);
  if (motivoPerda && motivoPerda.length > 0) {
    return { status: "lost", reason: `cf_motivo_perda = "${motivoPerda}"` };
  }

  // 3. Estado negociação explicit
  const estado = stringValue(cf.cf_estado_negociacao ?? cf.cf_Estado_Negociacao);
  if (estado) {
    if (/fechad|ganho|won/i.test(estado)) {
      return { status: "won", reason: `cf_estado_negociacao = "${estado}"` };
    }
    if (/perdid|lost/i.test(estado)) {
      return { status: "lost", reason: `cf_estado_negociacao = "${estado}"` };
    }
    if (/curso|aberto|aguarda|pending/i.test(estado)) {
      return { status: "open", reason: `cf_estado_negociacao = "${estado}"` };
    }
  }

  // 4. Falling back to ticket status alone.
  if (!isClosed) return { status: "open", reason: `status="${status || statusType}"` };

  return {
    status: "unknown",
    reason: `closed but no outcome rule matched (status="${status}")`,
  };
}

function stringValue(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}
