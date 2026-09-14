import { and, desc, eq, gte, lte } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import {
  db,
  conversationsTable,
  ticketsTable,
  operatorSummariesTable,
  runsTable,
} from "@workspace/db";
import { phoneFingerprint } from "@workspace/phone";
import { derivarAcoes, type Acao } from "./acoes.js";

/**
 * One agent's actions and coaching for one day.
 *
 * Both read what the daily analysis already produced — this never calls the
 * model. The panel refreshes twice a day and must not touch the analysis
 * budget; an LLM call reachable from here would quietly multiply it.
 */

/**
 * The seven rules, applied to this agent's conversations only.
 *
 * Filtered by `agentId`, which is the Ringover user id — the same value
 * `colaboradores.ringoverUserId` holds. An agent with no Ringover id gets an
 * empty list rather than everybody's actions, which would be a data leak
 * dressed as a feature.
 */
export async function listAcoesDoAgente(params: {
  ringoverUserId: string;
  data: string;
}): Promise<Acao[]> {
  const conversas = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.runDate, params.data),
        eq(conversationsTable.agentId, params.ringoverUserId),
      ),
    );

  if (conversas.length === 0) return [];

  // The customer's name, from whichever Desk ticket saw them last. Worth the
  // extra query: "+351 912 345 678" and "Marco Pacheco" are the same row, and
  // only one of them is something an agent recognises.
  const fingerprints = [
    ...new Set(
      conversas.map((c) => phoneFingerprint(c.customerPhone)).filter((f): f is string => !!f),
    ),
  ];
  const nomePorFp = new Map<string, string>();
  if (fingerprints.length > 0) {
    const rows = await db
      .select({ fp: ticketsTable.phoneFingerprint, nome: ticketsTable.contactName })
      .from(ticketsTable)
      .where(inArray(ticketsTable.phoneFingerprint, fingerprints))
      .orderBy(ticketsTable.createdTime);
    for (const r of rows) if (r.fp && r.nome) nomePorFp.set(r.fp, r.nome);
  }

  const todas = derivarAcoes(conversas, (telefone) => {
    const fp = phoneFingerprint(telefone);
    return (fp && nomePorFp.get(fp)) || null;
  });

  // `follow_up_pendente` is dropped here, and only here: the panel already has
  // a Seguimentos block that exists for exactly that, and on a real day the two
  // overlapped eleven rows to seven. The same promise listed twice, in two
  // places, with two different wordings is worse than listing it once — the
  // agent has to work out whether they are looking at one commitment or two.
  //
  // The supervisor's own "Ações do Dia" keeps them: that view has no
  // Seguimentos block, so there they are the only place the promise appears.
  return todas.filter((a) => a.tipo !== "follow_up_pendente");
}

export interface Coaching {
  paragraphOverview: string;
  strengths: string[];
  blindSpots: string[];
  closingRateObservations: string;
  coachingRecommendations: string[];
  /**
   * The day this reading is *about*, which is not always the day on screen.
   *
   * The panel shows today — today's missed calls, today's open tickets. A
   * reading of the day cannot: it is written once the day is over. So the two
   * are different clocks, and the reading carries its own so the card can say
   * which day it is talking about instead of implying it is this one.
   */
  data: string;
}

/**
 * How far back to look for a reading before giving up.
 *
 * A week covers a holiday or a Monday looking back at Friday. Beyond that the
 * advice is about a week the agent no longer remembers, and a stale reading
 * presented as current is worse than none.
 */
export const DIAS_DE_LEITURA = 7;

/**
 * The coaching the daily run wrote for this agent.
 *
 * Written by the model for the supervisor to read *about* the agent. Showing it
 * to the agent themselves is a management decision, not a technical one — the
 * prompt's tone rules were built for it, but that is not the same as it having
 * been decided. Kept behind its own function so turning it off is one line.
 */
export async function loadCoaching(params: {
  ringoverUserId: string;
  data: string;
}): Promise<Coaching | null> {
  // The most recent reading up to and including the requested day — not the
  // requested day itself.
  //
  // This is the bug this function used to have, and it showed up every single
  // morning. The morning run analyses *yesterday*; the panel shows *today*.
  // Asking for today's reading at nine o'clock therefore always missed, and
  // every agent opened the panel to "a análise deste dia ainda não correu" —
  // which reads as a broken panel and is in fact the system working exactly as
  // designed. What somebody wants at nine in the morning is yesterday's
  // reading, which is precisely the one that exists.
  const [row] = await db
    .select()
    .from(operatorSummariesTable)
    .where(
      and(
        eq(operatorSummariesTable.operatorId, params.ringoverUserId),
        lte(operatorSummariesTable.date, params.data),
        gte(operatorSummariesTable.date, diasAntes(params.data, DIAS_DE_LEITURA)),
      ),
    )
    .orderBy(desc(operatorSummariesTable.date))
    .limit(1);

  if (!row) return null;
  return {
    paragraphOverview: row.paragraphOverview ?? "",
    strengths: row.strengths ?? [],
    blindSpots: row.blindSpots ?? [],
    closingRateObservations: row.closingRateObservations ?? "",
    coachingRecommendations: row.coachingRecommendations ?? [],
    data: row.date,
  };
}

/** `YYYY-MM-DD`, n days earlier. The column is text, so the bound is text too. */
function diasAntes(data: string, dias: number): string {
  const [y, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - dias * 86_400_000).toISOString().slice(0, 10);
}

/* ── Frescura: o que é recente, e quão recente ──────────────────────────── */

/**
 * When the fifteen-minute sync last ran, and when conversations were last read.
 *
 * These are two different clocks and the panel used to show neither. It showed
 * the moment the page was built, labelled "atualizado" — which is always "há 0
 * min" and therefore says nothing at all. Worse, it reads as a promise: a
 * supervisor looking at a panel that claims to be current has no way to tell
 * that the coaching under it is from last Friday.
 *
 * So both are reported, separately:
 *
 *  - `sincronizacao` — the most recent ticket sync. Tickets carry `syncedAt`,
 *    written on every upsert, so the newest one is when the feed behind the
 *    task list last moved. This is the clock that matters for "has this task
 *    already been dealt with".
 *  - `analise` — the last day whose conversations were read, and when that
 *    finished. This is the clock that matters for the coaching and the day's
 *    actions, and it is normally hours or a weekend behind the other one.
 */
export interface Frescura {
  /** ISO instant of the most recent Desk sync, or null if nothing ever synced. */
  sincronizacao: string | null;
  /** The last analysed day and when that run finished. */
  analise: { data: string; quando: string } | null;
}

export async function loadFrescura(): Promise<Frescura> {
  const [sync, run] = await Promise.all([
    db
      .select({ syncedAt: ticketsTable.syncedAt })
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.syncedAt))
      .limit(1),
    db
      .select({ date: runsTable.date, updatedAt: runsTable.updatedAt })
      .from(runsTable)
      .where(eq(runsTable.status, "completed"))
      .orderBy(desc(runsTable.date))
      .limit(1),
  ]);

  return {
    sincronizacao: sync[0]?.syncedAt?.toISOString() ?? null,
    analise: run[0] ? { data: run[0].date, quando: run[0].updatedAt.toISOString() } : null,
  };
}

/**
 * Did this agent have any analysed conversation in the coaching window?
 *
 * This exists to tell two very different silences apart, which the panel used
 * to render with the same sentence:
 *
 *  - the analysis has not reached this week yet — a fault, or at least
 *    something to wait for;
 *  - the person simply took no calls — nothing is wrong and nothing is coming.
 *
 * Saying "ainda não há leitura" to somebody in the second case reads as a
 * broken panel, and they will report it as one. It cost a morning of
 * investigation to find that out.
 */
export async function teveConversas(params: {
  ringoverUserId: string;
  data: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.agentId, params.ringoverUserId),
        lte(conversationsTable.runDate, params.data),
        gte(conversationsTable.runDate, diasAntes(params.data, DIAS_DE_LEITURA)),
      ),
    )
    .limit(1);
  return row !== undefined;
}
