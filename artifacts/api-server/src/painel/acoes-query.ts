import { and, eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { db, conversationsTable, ticketsTable, operatorSummariesTable } from "@workspace/db";
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
}

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
  const [row] = await db
    .select()
    .from(operatorSummariesTable)
    .where(
      and(
        eq(operatorSummariesTable.date, params.data),
        eq(operatorSummariesTable.operatorId, params.ringoverUserId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    paragraphOverview: row.paragraphOverview ?? "",
    strengths: row.strengths ?? [],
    blindSpots: row.blindSpots ?? [],
    closingRateObservations: row.closingRateObservations ?? "",
    coachingRecommendations: row.coachingRecommendations ?? [],
  };
}
