import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, conversationsTable, ticketCommentsTable, ticketsTable } from "@workspace/db";
import { lisbonDateOffset } from "../lib/dates.js";
import type { ChamadaParaEvidencia, RespostaParaEvidencia } from "./evidencia.js";

/**
 * Loading the two records that can prove a task was done.
 *
 * Kept apart from `evidencia.ts` for the same reason `followups-query` is kept
 * apart from `followups-shape`: the rule about what counts as proof is worth
 * pinning with a test and a literal, and a test that needs a Postgres pins
 * nothing.
 *
 * ## Why a window, and why this one
 *
 * Both queries are bounded to the last `DIAS_DE_JANELA` days. A task older
 * than that is not going to be closed by activity we have not looked at — it
 * would already have been closed on a previous run — and an unbounded scan of
 * every conversation and every comment ever synced is a query that gets slower
 * every week for an answer that never changes.
 */

/**
 * Six weeks: comfortably past the oldest thing on a real panel (twenty days)
 * with room for a holiday in the middle.
 */
export const DIAS_DE_JANELA = 42;

export interface Evidencias {
  chamadas: ChamadaParaEvidencia[];
  respostas: RespostaParaEvidencia[];
}

/** The last nine digits — the only form Ringover and Desk agree on. */
function impressao(telefone: string | null): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return digitos.length >= 9 ? digitos.slice(-9) : null;
}

/**
 * Answered calls and agent replies from the recent past.
 *
 * `conversations` is the right source for calls rather than the raw Ringover
 * feed: a row exists there because the call had a transcript note, which is
 * itself a decent signal that somebody actually spoke. Its `durationSec` is
 * the whole conversation, which is the number the minimum-duration rule wants.
 *
 * `ticketIds` narrows the comment scan to the tickets actually on this panel.
 * Without it the query reads every comment in the window for every agent.
 */
export async function carregarEvidencias(
  ticketIds: readonly string[],
  now: Date = new Date(),
): Promise<Evidencias> {
  const desde = lisbonDateOffset(DIAS_DE_JANELA, now);

  const [conversas, comentarios] = await Promise.all([
    db
      .select({
        customerPhone: conversationsTable.customerPhone,
        runDate: conversationsTable.runDate,
        durationSec: conversationsTable.durationSec,
      })
      .from(conversationsTable)
      .where(gte(conversationsTable.runDate, desde)),

    ticketIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            ticketId: ticketCommentsTable.ticketId,
            commentedTime: ticketCommentsTable.commentedTime,
            authorType: ticketCommentsTable.authorType,
            ticketNumber: ticketsTable.ticketNumber,
          })
          .from(ticketCommentsTable)
          .leftJoin(ticketsTable, eq(ticketCommentsTable.ticketId, ticketsTable.id))
          .where(
            and(
              inArray(ticketCommentsTable.ticketId, [...ticketIds]),
              isNotNull(ticketCommentsTable.commentedTime),
            ),
          ),
  ]);

  const chamadas: ChamadaParaEvidencia[] = [];
  for (const c of conversas) {
    const fp = impressao(c.customerPhone);
    if (!fp) continue;
    chamadas.push({
      fingerprint: fp,
      dia: c.runDate,
      // A conversation row exists because there were calls with a transcript;
      // a zero or absent duration is an unknown, and `procurarProva` treats an
      // unknown as "not proof" rather than as a long call.
      atendida: (c.durationSec ?? 0) > 0,
      duracaoSeg: c.durationSec,
    });
  }

  const respostas: RespostaParaEvidencia[] = [];
  for (const r of comentarios) {
    if (!r.commentedTime) continue;
    respostas.push({
      ticketId: r.ticketId,
      quando: r.commentedTime.toISOString(),
      autorTipo: r.authorType,
      ticketNumber: r.ticketNumber ?? null,
    });
  }

  return { chamadas, respostas };
}
