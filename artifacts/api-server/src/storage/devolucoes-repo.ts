import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, devolucoesTable, colaboradoresTable, type Devolucao } from "@workspace/db";
import type { DevolucaoCandidate } from "../painel/devolucoes.js";

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

  const values = candidates.map((c) => ({
    ringoverCallId: c.ringoverCallId,
    data: c.data,
    colaboradorId: c.ringoverUserId ? (colaboradorByRingoverId.get(c.ringoverUserId) ?? null) : null,
    numeroCliente: c.numeroCliente,
    numeroNormalizado: c.numeroNormalizado,
    horaChamada: c.horaChamada,
    estado: c.estado,
    resolvidaAt: c.resolvidaAt,
    resolvidaPor: c.resolvidaPor,
    origem: c.origem,
  }));

  await db
    .insert(devolucoesTable)
    .values(values)
    .onConflictDoUpdate({
      target: devolucoesTable.ringoverCallId,
      set: {
        colaboradorId: sql`excluded.colaborador_id`,
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
 * Close one devolução.
 *
 * The outcome is distinguished rather than collapsed, because the spec
 * requires 403 specifically for a cross-agent write — a caller must be told
 * "not yours", not "not found". The ownership check is still done in SQL, in
 * the same statement as the update, so there is no window between checking and
 * writing.
 */
export type ConcluirResultado =
  | { estado: "ok"; row: Devolucao }
  | { estado: "inexistente" }
  | { estado: "de-outro-agente" }
  | { estado: "ja-resolvida" };

export async function concluirDevolucao(params: {
  id: number;
  colaboradorId: number;
  estado: "devolvida" | "dispensada";
}): Promise<ConcluirResultado> {
  const [row] = await db
    .update(devolucoesTable)
    .set({
      estado: params.estado,
      resolvidaAt: new Date(),
      resolvidaPor: String(params.colaboradorId),
      origem: "manual",
    })
    .where(
      and(
        eq(devolucoesTable.id, params.id),
        eq(devolucoesTable.colaboradorId, params.colaboradorId),
        eq(devolucoesTable.estado, "pendente"),
      ),
    )
    .returning();

  if (row) return { estado: "ok", row };

  // Nothing was updated. Read the row back to say why — this path is only
  // reached on a rejected write, so the extra query costs nothing in practice.
  const [existente] = await db
    .select()
    .from(devolucoesTable)
    .where(eq(devolucoesTable.id, params.id))
    .limit(1);

  if (!existente) return { estado: "inexistente" };
  if (existente.colaboradorId !== params.colaboradorId) return { estado: "de-outro-agente" };
  return { estado: "ja-resolvida" };
}
