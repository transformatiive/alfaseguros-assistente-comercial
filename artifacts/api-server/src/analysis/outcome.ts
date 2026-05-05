import type { ZohoTicket } from "@workspace/zoho-desk";

export type OutcomeStatus = "won" | "lost" | "open" | "unknown";

export interface Outcome {
  status: OutcomeStatus;
  reason: string;
}

/**
 * Classify a Zoho Desk ticket as won / lost / open / unknown.
 *
 * Primary signal: cf_estado_do_negocio
 *   "GANHO"         → won
 *   "PERDIDO"       → lost
 *   "EM TRATAMENTO" | "EM ESPERA" | "TRATADO" → open
 *
 * Fallback signals (kept for tickets that pre-date the cf field):
 *   cf_apolice_emitida = "Sim" → won
 *   cf_motivo_perda populated   → lost
 *   ticket status open          → open
 *   ticket closed, no rule      → unknown
 *
 * Order matters: the first rule that matches wins.
 */
export function classifyOutcome(ticket: ZohoTicket): Outcome {
  const cf = (ticket.cf ?? {}) as Record<string, unknown>;
  const status = (ticket.status ?? "").trim();
  const statusType = (ticket.statusType ?? "").trim().toLowerCase();
  const isClosed = statusType === "closed" || /closed|resolved|fechad/i.test(status);

  // ── 1. cf_estado_do_negocio — primary field confirmed by Alfaseguros ────────
  const estadoNegocio = stringValue(
    cf.cf_estado_do_negocio ?? cf.cf_Estado_do_Negocio ?? cf.cf_Estado_Do_Negocio,
  );
  if (estadoNegocio) {
    const norm = estadoNegocio.toUpperCase().trim();
    if (norm === "GANHO") {
      return { status: "won", reason: `cf_estado_do_negocio = "${estadoNegocio}"` };
    }
    if (norm === "PERDIDO") {
      return { status: "lost", reason: `cf_estado_do_negocio = "${estadoNegocio}"` };
    }
    // "EM TRATAMENTO" | "EM ESPERA" | "TRATADO" and any other value → open
    return { status: "open", reason: `cf_estado_do_negocio = "${estadoNegocio}"` };
  }

  // ── 2. Fallback: apólice emitida = Sim → won ────────────────────────────────
  const apolice = stringValue(cf.cf_apolice_emitida ?? cf.cf_Apolice_Emitida);
  if (apolice && /^sim|true|y(es)?$/i.test(apolice)) {
    return { status: "won", reason: `cf_apolice_emitida = "${apolice}"` };
  }

  // ── 3. Fallback: motivo perda preenchido → lost ─────────────────────────────
  const motivoPerda = stringValue(cf.cf_motivo_perda ?? cf.cf_Motivo_Perda);
  if (motivoPerda && motivoPerda.length > 0) {
    return { status: "lost", reason: `cf_motivo_perda = "${motivoPerda}"` };
  }

  // ── 4. Ticket ainda aberto → open ──────────────────────────────────────────
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
