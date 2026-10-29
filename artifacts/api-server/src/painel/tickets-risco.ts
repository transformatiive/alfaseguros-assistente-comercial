import { and, asc, eq, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { db, ticketsTable } from "@workspace/db";
import { estadoDoNegocio, negocioDecidido, nomeDoNegocio } from "./followups-contexto.js";

/**
 * "Tickets em risco" — open tickets assigned to this agent that have been open
 * for more than 24 hours.
 *
 * The age threshold is a business rule, not a constant to tune casually: it is
 * the SLA the team works to, and it is the same 24 hours the follow-up payload
 * reports as `follow_up_sla_hours`.
 */
export const RISCO_THRESHOLD_HOURS = 24;

export interface TicketEmRisco {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  idadeHoras: number;
  criadoEm: string;
  deskUrl: string;
  /** Who the ticket is with. A row without a name is a row you cannot act on. */
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** "Simulação · EM TRATAMENTO": o negócio do ticket, como o Desk o tem. */
  negocio: string | null;
}

/**
 * The requester's email, dug out of the stored Desk payload.
 *
 * There is no column for it: the sync keeps the whole ticket in `rawJson` and
 * we never needed the address until the panel started saying *how* to reach
 * the person. Desk puts it in two places depending on the channel — top level
 * for email tickets, on the embedded contact otherwise — so both are tried.
 *
 * Deliberately total: a shape we did not expect returns null rather than
 * throwing, because an unreadable address must not take down the whole block.
 */
export function emailDoTicket(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const raw = rawJson as Record<string, unknown>;
  const direto = typeof raw.email === "string" ? raw.email.trim() : "";
  if (direto) return direto;
  const contacto = raw.contact;
  if (contacto && typeof contacto === "object") {
    const e = (contacto as Record<string, unknown>).email;
    if (typeof e === "string" && e.trim()) return e.trim();
  }
  return null;
}

/**
 * The portal slug in a Desk URL. Zoho routes on this name, never on the
 * numeric org id — which is the whole of the bug this replaced.
 */
export const PORTAL_DESK = "alfaseguros";

/**
 * Desk deep link for a ticket, in the agent console.
 *
 * Exported because every task with a ticket deserves one, not just the rows
 * that came *from* the ticket table: a promise made on a call carries a
 * `linked_ticket_id` and used to render without a way to reach it.
 *
 * ## The shape, and why it took three tries
 *
 * `/agent/{orgId}/tickets/details/{id}` 404'd: the console routes on the
 * portal name, not the numeric org id. Desk's own `webUrl` then gave the
 * classic `/support/alfaseguros/ShowHomePage.do#Cases/dv/{id}` page, which
 * the team does not use and which, in October 2026, led Nuno to a deleted
 * duplicate of the ticket he was looking for.
 *
 * The link the team copies from its own browser is
 * `/agent/{portal}/{department}/tickets/details/{id}`, the department being
 * Desk's `sanitizedName`. The department comes from the ticket when Desk
 * gave it to us, and falls back to Alfa Seguros, the default department,
 * where almost every ticket lives.
 */
export function urlDoDesk(ticketId: string, raw?: unknown): string {
  const dep =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).departmentId : undefined;
  const slug = (typeof dep === "string" && DEPARTAMENTOS_DESK[dep]) || DEPARTAMENTO_POR_OMISSAO;
  return `https://desk.zoho.com/agent/${PORTAL_DESK}/${encodeURIComponent(slug)}/tickets/details/${encodeURIComponent(ticketId)}`;
}

/** Desk department id → `sanitizedName`, as `GET /departments` returns it. */
const DEPARTAMENTOS_DESK: Record<string, string> = {
  "367662000000006907": "alfa-seguros",
  "367662000097048676": "corporate",
  "367662000128357813": "contratação-pública",
};
const DEPARTAMENTO_POR_OMISSAO = "alfa-seguros";

/**
 * Apagado no Desk: está no lixo, ou foi apagado de vez. A API continua a
 * devolvê-lo por id, com o estado que tinha, e por isso ele ficava "aberto"
 * aqui para sempre. Era o caso do #172698, um duplicado de uma chamada
 * perdida que a Vânia apagou a 02/09 e que o painel mostrava com 46 dias de
 * atraso.
 */
export const ESTADO_APAGADO = "Deleted";

/** Hours between `createdTime` and `now`, rounded down. */
export function idadeEmHoras(criadoEm: Date, now: Date): number {
  return Math.floor((now.getTime() - criadoEm.getTime()) / 3_600_000);
}

/**
 * Open tickets assigned to `zid`, older than the threshold, oldest first.
 *
 * "Open" is `statusType <> 'Closed'`, with a null `statusType` treated as open:
 * Desk leaves it unset on some channels, and a ticket that might be open is
 * better surfaced than silently dropped from the agent's list.
 */
export async function listTicketsEmRisco(params: {
  zid: string;
  orgId?: string;
  now?: Date;
}): Promise<TicketEmRisco[]> {
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - RISCO_THRESHOLD_HOURS * 3_600_000);

  const rows = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.assigneeId, params.zid),
        or(notInArray(ticketsTable.statusType, ["Closed", ESTADO_APAGADO]), isNull(ticketsTable.statusType)),
        lt(ticketsTable.createdTime, cutoff),
      ),
    )
    .orderBy(asc(ticketsTable.createdTime));

  return rows.flatMap((t) => {
    // The `lt` above already excludes nulls, but the column is nullable and
    // the type says so — narrow rather than assert.
    if (!t.createdTime) return [];
    // Um negócio GANHO, PERDIDO ou TRATADO já não espera por nós, mesmo que
    // o ticket tenha ficado aberto: a apólice saiu, ou a decisão está tomada.
    const estado = estadoDoNegocio(t.customFieldsJson);
    if (negocioDecidido(estado)) return [];
    const nome = nomeDoNegocio(t.customFieldsJson);
    return [
      {
        id: t.id,
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        status: t.status,
        idadeHoras: idadeEmHoras(t.createdTime, now),
        criadoEm: t.createdTime.toISOString(),
        deskUrl: urlDoDesk(t.id, t.rawJson),
        contactName: t.contactName,
        contactPhone: t.contactPhone,
        contactEmail: emailDoTicket(t.rawJson),
        negocio: [nome, estado].filter(Boolean).join(" · ") || null,
      },
    ];
  });
}

/**
 * Desk links for a set of ticket ids, with the department each ticket is in.
 *
 * Built in one query rather than per row: a panel routinely references thirty
 * or forty tickets, and thirty round trips to save a `WHERE id IN` is a cost
 * with nothing bought.
 *
 * Ids with no row are absent; the caller falls back to `urlDoDesk` with the
 * default department.
 */
export async function urlsDeTickets(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return new Map();

  const rows = await db
    .select({ id: ticketsTable.id, rawJson: ticketsTable.rawJson })
    .from(ticketsTable)
    .where(inArray(ticketsTable.id, unicos));

  const mapa = new Map<string, string>();
  for (const r of rows) mapa.set(r.id, urlDoDesk(r.id, r.rawJson));
  return mapa;
}

/**
 * Desk ticket numbers for a set of ticket ids.
 *
 * Some rows know their ticket only by id — a missed call matched to a ticket,
 * a promise the cases linked — and the agent finds a process in Desk by its
 * number, not by an id nobody sees.
 */
export async function numerosDeTickets(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return new Map();

  const rows = await db
    .select({ id: ticketsTable.id, ticketNumber: ticketsTable.ticketNumber })
    .from(ticketsTable)
    .where(inArray(ticketsTable.id, unicos));

  const mapa = new Map<string, string>();
  for (const r of rows) if (r.ticketNumber) mapa.set(r.id, r.ticketNumber);
  return mapa;
}

/** The customer's process in Desk, for a row that has no ticket of its own. */
export interface TicketDoCliente {
  id: string;
  numero: string;
  url: string;
  /**
   * True when the customer has no open ticket and this is their last closed
   * one. The row shows it marked as closed: it is there to read context, not
   * because there is work in it.
   */
  fechado: boolean;
}

/**
 * The ticket to show for each phone fingerprint: the most recent open one,
 * or, when there is none, the one that closed last.
 *
 * Used only to *show* which process a row belongs to — never to close a task
 * or to decide whose panel it is on. A promise made on a call is usually about
 * a ticket the customer already had before ringing, and the call-to-ticket
 * window (which starts on the day of the call) cannot see that one.
 *
 * "Open" is the same rule as the panel's ticket list: not closed, and the
 * business not already decided. Deleted tickets are never shown.
 */
export async function ticketsDoClientePorFingerprint(
  fingerprints: readonly string[],
): Promise<Map<string, TicketDoCliente>> {
  const unicos = [...new Set(fingerprints)].filter(Boolean);
  if (unicos.length === 0) return new Map();

  const rows = await db
    .select({
      id: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
      fp: ticketsTable.phoneFingerprint,
      statusType: ticketsTable.statusType,
      createdTime: ticketsTable.createdTime,
      closedTime: ticketsTable.closedTime,
      rawJson: ticketsTable.rawJson,
      customFieldsJson: ticketsTable.customFieldsJson,
    })
    .from(ticketsTable)
    .where(
      and(
        inArray(ticketsTable.phoneFingerprint, unicos),
        or(notInArray(ticketsTable.statusType, [ESTADO_APAGADO]), isNull(ticketsTable.statusType)),
      ),
    );

  return escolherTicketDoCliente(
    rows.map((r) => ({
      id: r.id,
      numero: r.ticketNumber,
      fp: r.fp,
      url: urlDoDesk(r.id, r.rawJson),
      fechado:
        r.statusType === "Closed" || negocioDecidido(estadoDoNegocio(r.customFieldsJson)),
      criadoEm: r.createdTime?.getTime() ?? 0,
      fechadoEm: r.closedTime?.getTime() ?? r.createdTime?.getTime() ?? 0,
    })),
  );
}

/** One row of the lookup above, already read. Exported for the test. */
export interface CandidatoTicket {
  id: string;
  numero: string | null;
  fp: string | null;
  url: string;
  fechado: boolean;
  criadoEm: number;
  fechadoEm: number;
}

/** Newest open ticket per number; failing that, the one that closed last. */
export function escolherTicketDoCliente(
  candidatos: readonly CandidatoTicket[],
): Map<string, TicketDoCliente> {
  const abertos = new Map<string, CandidatoTicket>();
  const fechados = new Map<string, CandidatoTicket>();
  for (const c of candidatos) {
    if (!c.fp || !c.numero) continue;
    if (c.fechado) {
      const atual = fechados.get(c.fp);
      if (!atual || c.fechadoEm > atual.fechadoEm) fechados.set(c.fp, c);
    } else {
      const atual = abertos.get(c.fp);
      if (!atual || c.criadoEm > atual.criadoEm) abertos.set(c.fp, c);
    }
  }
  const mapa = new Map<string, TicketDoCliente>();
  for (const fp of new Set([...abertos.keys(), ...fechados.keys()])) {
    const c = abertos.get(fp) ?? fechados.get(fp);
    if (c?.numero) mapa.set(fp, { id: c.id, numero: c.numero, url: c.url, fechado: c.fechado });
  }
  return mapa;
}
