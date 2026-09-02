import { phoneFingerprint } from "@workspace/phone";

/**
 * Attribute a missed call to the agent who already owns it.
 *
 * The n8n "Chamadas Perdidas" workflow fires on every Ringover `missed` event
 * and creates a Zoho Desk ticket **with an owner**: the contact's own agent
 * when the number is known, round-robin otherwise. That decision is the source
 * of truth for who is responsible.
 *
 * So this does not re-derive an owner — it reads the one that exists. Matching
 * on our side rather than re-running the rule keeps the panel and Desk saying
 * the same thing, including when the round-robin picked someone the panel could
 * never have guessed.
 *
 * Pure by design: no database, no network, so the matching window and the
 * tie-breaks can be tested exactly.
 */

/**
 * How long after a missed call its ticket may appear. The ticket is created by
 * a webhook, so it is normally seconds; 30 minutes is slack for a retry or a
 * queued execution, while staying far below the gap between two calls from the
 * same customer on a busy day.
 */
export const JANELA_TICKET_MS = 30 * 60 * 1000;

export interface TicketParaAtribuicao {
  id: string;
  phoneFingerprint: string | null;
  createdTime: Date | null;
  assigneeId: string | null;
}

export interface ChamadaParaAtribuir {
  ringoverCallId: string;
  numeroNormalizado: string;
  horaChamada: Date;
}

export interface Atribuicao {
  ticketId: string;
  /** Zoho Desk agent id, to be mapped to `colaboradores.zid` by the caller. */
  zid: string | null;
}

/**
 * Match each call to the ticket created for it, if any.
 *
 * A ticket is a candidate when the phone fingerprint matches and it was created
 * **at or after** the call, within the window. The earliest such ticket wins:
 * with several calls from one customer, each takes the ticket that followed it
 * most closely.
 *
 * A ticket is claimed by at most one call, so two calls minutes apart cannot
 * both point at the same ticket and inflate the picture.
 */
export function atribuirPorTicket(
  chamadas: readonly ChamadaParaAtribuir[],
  tickets: readonly TicketParaAtribuicao[],
): Map<string, Atribuicao> {
  const porFingerprint = new Map<string, TicketParaAtribuicao[]>();
  for (const t of tickets) {
    const fp = t.phoneFingerprint ? phoneFingerprint(t.phoneFingerprint) : "";
    if (!fp || !t.createdTime) continue;
    porFingerprint.set(fp, [...(porFingerprint.get(fp) ?? []), t]);
  }
  for (const lista of porFingerprint.values()) {
    lista.sort((a, b) => (a.createdTime?.getTime() ?? 0) - (b.createdTime?.getTime() ?? 0));
  }

  // Oldest call first, so the earliest call claims the earliest ticket.
  const ordenadas = [...chamadas].sort(
    (a, b) => a.horaChamada.getTime() - b.horaChamada.getTime(),
  );

  const usados = new Set<string>();
  const out = new Map<string, Atribuicao>();

  for (const c of ordenadas) {
    const candidatos = porFingerprint.get(c.numeroNormalizado) ?? [];
    const t = candidatos.find((cand) => {
      if (usados.has(cand.id)) return false;
      const dt = (cand.createdTime as Date).getTime() - c.horaChamada.getTime();
      return dt >= 0 && dt <= JANELA_TICKET_MS;
    });
    if (!t) continue;
    usados.add(t.id);
    out.set(c.ringoverCallId, { ticketId: t.id, zid: t.assigneeId ?? null });
  }

  return out;
}
