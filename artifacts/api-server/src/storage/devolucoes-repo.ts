import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, devolucoesTable, colaboradoresTable, ticketsTable, type Devolucao } from "@workspace/db";
import { gte, lte } from "drizzle-orm";
import type { DevolucaoCandidate } from "../painel/devolucoes.js";
import { atribuirPorTicket, type TicketParaAtribuicao } from "../painel/atribuicao.js";

/**
 * Storage for "chamadas por devolver". Per CLAUDE.md this is the only place
 * Drizzle is touched for this table.
 */

/**
 * Upsert a day's candidates, keyed on `ringoverCallId`.
 *
 * The `where` clause on the conflict branch is the whole point: an existing row
 * is only refreshed while it is still `pendente`. Once an agent has marked it
 * `devolvida` or `dispensada`, a recompute leaves it alone — otherwise the
 * twice-daily refresh would resurrect work the agent had already closed.
 *
 * `colaboradorId` is resolved here rather than in `computeDevolucoes` because
 * the mapping from Ringover user_id to colaborador lives in the database.
 */
export async function upsertDevolucoes(candidates: readonly DevolucaoCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;

  // --- Attribution, step 1: the ticket n8n already created for this call ---
  //
  // Read the owner rather than deriving one. The "Chamadas Perdidas" workflow
  // has already decided — contact's own agent, or round-robin — and the panel
  // must agree with Desk, including when round-robin picked someone no rule on
  // our side could have predicted.
  const horas = candidates.map((c) => c.horaChamada.getTime());
  const janelaDe = new Date(Math.min(...horas));
  const janelaAte = new Date(Math.max(...horas) + 60 * 60 * 1000);

  const ticketRows = await db
    .select({
      id: ticketsTable.id,
      phoneFingerprint: ticketsTable.phoneFingerprint,
      createdTime: ticketsTable.createdTime,
      assigneeId: ticketsTable.assigneeId,
    })
    .from(ticketsTable)
    .where(
      and(gte(ticketsTable.createdTime, janelaDe), lte(ticketsTable.createdTime, janelaAte)),
    );

  const atribuicoes = atribuirPorTicket(
    candidates.map((c) => ({
      ringoverCallId: c.ringoverCallId,
      numeroNormalizado: c.numeroNormalizado,
      horaChamada: c.horaChamada,
    })),
    ticketRows as TicketParaAtribuicao[],
  );

  const zids = [
    ...new Set(
      [...atribuicoes.values()].map((a) => a.zid).filter((z): z is string => z !== null),
    ),
  ];
  const colaboradorPorZid = new Map<string, number>();
  if (zids.length > 0) {
    const rows = await db
      .select({ id: colaboradoresTable.id, zid: colaboradoresTable.zid })
      .from(colaboradoresTable)
      .where(inArray(colaboradoresTable.zid, zids));
    for (const r of rows) if (r.zid) colaboradorPorZid.set(r.zid, r.id);
  }

  const ringoverIds = [
    ...new Set(candidates.map((c) => c.ringoverUserId).filter((v): v is string => v !== null)),
  ];
  const colaboradorByRingoverId = new Map<string, number>();
  if (ringoverIds.length > 0) {
    const rows = await db
      .select({ id: colaboradoresTable.id, ringoverUserId: colaboradoresTable.ringoverUserId })
      .from(colaboradoresTable)
      .where(inArray(colaboradoresTable.ringoverUserId, ringoverIds));
    for (const r of rows) {
      if (r.ringoverUserId) colaboradorByRingoverId.set(r.ringoverUserId, r.id);
    }
  }

  const values = candidates.map((c) => {
    const atrib = atribuicoes.get(c.ringoverCallId);
    // Order of preference: the ticket's owner (what n8n decided), then the
    // call's own agent, then whoever called the customer back. The last two
    // only ever fire when no ticket was matched.
    const porTicket = atrib?.zid ? (colaboradorPorZid.get(atrib.zid) ?? null) : null;
    const porChamada = c.ringoverUserId
      ? (colaboradorByRingoverId.get(c.ringoverUserId) ?? null)
      : null;
    return {
    ringoverCallId: c.ringoverCallId,
    data: c.data,
    ticketId: atrib?.ticketId ?? null,
    colaboradorId: porTicket ?? porChamada,
    numeroCliente: c.numeroCliente,
    numeroNormalizado: c.numeroNormalizado,
    horaChamada: c.horaChamada,
    estado: c.estado,
    resolvidaAt: c.resolvidaAt,
    resolvidaPor: c.resolvidaPor,
    origem: c.origem,
    };
  });

  await db
    .insert(devolucoesTable)
    .values(values)
    .onConflictDoUpdate({
      target: devolucoesTable.ringoverCallId,
      set: {
        colaboradorId: sql`excluded.colaborador_id`,
        ticketId: sql`excluded.ticket_id`,
        estado: sql`excluded.estado`,
        resolvidaAt: sql`excluded.resolvida_at`,
        resolvidaPor: sql`excluded.resolvida_por`,
        origem: sql`excluded.origem`,
      },
      setWhere: sql`${devolucoesTable.estado} = 'pendente'`,
    });

  return values.length;
}

/** This agent's still-pending devoluções for a day, oldest first. */
export async function listDevolucoesPendentes(
  colaboradorId: number,
  data: string,
): Promise<Devolucao[]> {
  return db
    .select()
    .from(devolucoesTable)
    .where(
      and(
        eq(devolucoesTable.colaboradorId, colaboradorId),
        eq(devolucoesTable.data, data),
        eq(devolucoesTable.estado, "pendente"),
      ),
    )
    .orderBy(asc(devolucoesTable.horaChamada));
}

/**
 * Pending devoluções nobody is responsible for, oldest first.
 *
 * An unanswered inbound call usually carries no Ringover `user_id` — nobody
 * picked it up, so there is nobody to attribute it to. `computeDevolucoes`
 * falls back to whoever called the customer back later, but when nobody did,
 * the row has a null `colaboradorId`.
 *
 * Without this query those rows are invisible to everyone: the per-agent list
 * filters on `colaboradorId`, and the team totals are the sum of the per-agent
 * counts. A customer nobody called back is precisely the case the panel exists
 * to surface, so it goes to the supervisor rather than nowhere.
 */
export async function listDevolucoesNaoAtribuidas(data: string): Promise<Devolucao[]> {
  return db
    .select()
    .from(devolucoesTable)
    .where(
      and(
        isNull(devolucoesTable.colaboradorId),
        eq(devolucoesTable.data, data),
        eq(devolucoesTable.estado, "pendente"),
      ),
    )
    .orderBy(asc(devolucoesTable.horaChamada));
}

/**
 * Close one devolução.
 *
 * The outcome is distinguished rather than collapsed, because the spec
 * requires 403 specifically for a cross-agent write — a caller must be told
 * "not yours", not "not found". The ownership check is still done in SQL, in
 * the same statement as the update, so there is no window between checking and
 * writing.
 */
export type ConcluirResultado =
  | { estado: "ok"; row: Devolucao; tambemResolvidas: number }
  | { estado: "inexistente" }
  | { estado: "de-outro-agente" }
  | { estado: "ja-resolvida" };

export async function concluirDevolucao(params: {
  id: number;
  colaboradorId: number;
  estado: "devolvida" | "dispensada";
}): Promise<ConcluirResultado> {
  const [alvo] = await db
    .select()
    .from(devolucoesTable)
    .where(eq(devolucoesTable.id, params.id))
    .limit(1);

  if (!alvo) return { estado: "inexistente" };
  if (alvo.colaboradorId !== params.colaboradorId) return { estado: "de-outro-agente" };
  if (alvo.estado !== "pendente") return { estado: "ja-resolvida" };

  // Close every pending attempt from the same number on the same day, not just
  // the row that was clicked. The panel groups repeat calls into one line, and
  // one call back settles the debt for all of them — the same rule
  // `computeDevolucoes` already applies when it auto-resolves.
  const linhas = await db
    .update(devolucoesTable)
    .set({
      estado: params.estado,
      resolvidaAt: new Date(),
      resolvidaPor: String(params.colaboradorId),
      origem: "manual",
    })
    .where(
      and(
        eq(devolucoesTable.colaboradorId, params.colaboradorId),
        eq(devolucoesTable.data, alvo.data),
        eq(devolucoesTable.numeroNormalizado, alvo.numeroNormalizado),
        eq(devolucoesTable.estado, "pendente"),
      ),
    )
    .returning();

  const principal = linhas.find((l) => l.id === params.id) ?? linhas[0];
  if (!principal) return { estado: "ja-resolvida" };
  return { estado: "ok", row: principal, tambemResolvidas: linhas.length - 1 };
}
