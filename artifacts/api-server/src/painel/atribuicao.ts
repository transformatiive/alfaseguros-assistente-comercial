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
  /** Lisbon day, `YYYY-MM-DD`. Groups repeat calls the same way the UI does. */
  data: string;
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

/**
 * The reason a devolução ended up with the owner it has.
 *
 * Persisted so the panel can say *why* — "dono do ticket desta chamada" is a
 * fact, "dono do último ticket deste cliente" is an inference, and an agent
 * deciding whether to trust the row deserves to know which one they are
 * looking at.
 */
export type OrigemAtribuicao = "ticket" | "grupo" | "historico" | "chamada";

/**
 * Spread a group's owner to the calls in it that matched no ticket.
 *
 * A customer who calls five times in thirteen minutes produces five missed
 * calls and, because n8n dedups, usually **one** ticket. The first call claims
 * it; the other four match nothing. But the panel already collapses those five
 * into a single line — so leaving four of them ownerless splits one piece of
 * work between an agent's list and the shared bucket, and the customer appears
 * twice on screen.
 *
 * The group is the same one the UI draws: same day, same number. Only the
 * owner travels — never the `ticketId`, because those calls genuinely have no
 * ticket of their own and copying it would make the supervisor's
 * double-counting discount fire once per call instead of once per ticket.
 */
export function propagarNoGrupo(
  chamadas: readonly ChamadaParaAtribuir[],
  atribuicoes: ReadonlyMap<string, Atribuicao>,
): Map<string, string> {
  const zidPorGrupo = new Map<string, string>();
  for (const c of chamadas) {
    const a = atribuicoes.get(c.ringoverCallId);
    if (!a?.zid) continue;
    const chave = `${c.data}|${c.numeroNormalizado}`;
    // First call of the group wins, deterministically, when a repeat caller
    // somehow produced two tickets with different owners.
    if (!zidPorGrupo.has(chave)) zidPorGrupo.set(chave, a.zid);
  }

  const out = new Map<string, string>();
  for (const c of chamadas) {
    if (atribuicoes.has(c.ringoverCallId)) continue;
    const zid = zidPorGrupo.get(`${c.data}|${c.numeroNormalizado}`);
    if (zid) out.set(c.ringoverCallId, zid);
  }
  return out;
}

/**
 * Fall back to the owner of the customer's most recent previous ticket.
 *
 * This is not a new rule — it is the one Smart Routing already runs on every
 * incoming call: look the number up in Desk, find their agent, send the call
 * there. Applying it to a missed call keeps the panel consistent with where
 * the phone system was already trying to route that person.
 *
 * It is an inference, not a fact, which is why it is the last resort and why
 * it is recorded as `historico`. A customer with no ticket at all is a genuinely
 * new caller and stays unattributed — the shared bucket is the right answer
 * there, not a guess.
 *
 * `ultimoTicketPorFingerprint` is supplied by the caller (it needs the
 * database); this function stays pure so the precedence is testable.
 */
export function atribuirPorHistorico(
  chamadas: readonly ChamadaParaAtribuir[],
  jaAtribuidas: ReadonlySet<string>,
  ultimoTicketPorFingerprint: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of chamadas) {
    if (jaAtribuidas.has(c.ringoverCallId)) continue;
    const zid = ultimoTicketPorFingerprint.get(c.numeroNormalizado);
    if (zid) out.set(c.ringoverCallId, zid);
  }
  return out;
}
