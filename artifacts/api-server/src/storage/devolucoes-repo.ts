import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, devolucoesTable, colaboradoresTable, ticketsTable, type Devolucao } from "@workspace/db";
import { gte, lte } from "drizzle-orm";
import type { DevolucaoCandidate } from "../painel/devolucoes.js";
import {
  atribuirPorHistorico,
  atribuirPorTicket,
  propagarNoGrupo,
  type ChamadaParaAtribuir,
  type OrigemAtribuicao,
  type TicketParaAtribuicao,
} from "../painel/atribuicao.js";

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

  const chamadas: ChamadaParaAtribuir[] = candidates.map((c) => ({
    ringoverCallId: c.ringoverCallId,
    data: c.data,
    numeroNormalizado: c.numeroNormalizado,
    horaChamada: c.horaChamada,
  }));

  const atribuicoes = atribuirPorTicket(chamadas, ticketRows as TicketParaAtribuicao[]);

  // --- Step 2: spread a group's owner to the repeat calls in it ---
  //
  // Measured on 2026-08-28: of 45 calls that matched no ticket, most were
  // second and third attempts by customers whose ticket had already been
  // claimed by their first attempt. The panel draws those as one line, so the
  // owner has to cover the whole line.
  const porGrupo = propagarNoGrupo(chamadas, atribuicoes);

  // --- Step 3: the owner of this customer's most recent previous ticket ---
  //
  // Only for calls still ownerless after steps 1 and 2, and only when the
  // customer has any ticket history at all. A number Desk has never seen is a
  // first-time caller: they go to the shared bucket, not to a guess.
  const semDono = new Set(
    chamadas
      .filter((c) => !atribuicoes.has(c.ringoverCallId) && !porGrupo.has(c.ringoverCallId))
      .map((c) => c.numeroNormalizado),
  );
  const ultimoTicketPorFingerprint = new Map<string, string>();
  if (semDono.size > 0) {
    const historicos = await db
      .select({
        phoneFingerprint: ticketsTable.phoneFingerprint,
        assigneeId: ticketsTable.assigneeId,
      })
      .from(ticketsTable)
      .where(
        and(
          inArray(ticketsTable.phoneFingerprint, [...semDono]),
          isNotNull(ticketsTable.assigneeId),
        ),
      )
      .orderBy(desc(ticketsTable.createdTime));
    for (const h of historicos) {
      // Ordered newest first, so the first row per number is the latest ticket.
      if (!h.phoneFingerprint || !h.assigneeId) continue;
      if (!ultimoTicketPorFingerprint.has(h.phoneFingerprint)) {
        ultimoTicketPorFingerprint.set(h.phoneFingerprint, h.assigneeId);
      }
    }
  }
  const porHistorico = atribuirPorHistorico(
    chamadas,
    new Set([...atribuicoes.keys(), ...porGrupo.keys()]),
    ultimoTicketPorFingerprint,
  );

  const zids = [
    ...new Set([
      ...[...atribuicoes.values()].map((a) => a.zid).filter((z): z is string => z !== null),
      ...porGrupo.values(),
      ...porHistorico.values(),
    ]),
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

    // Strongest evidence first: the ticket for this exact call, then the ticket
    // for another call in the same group, then the call's own Ringover agent
    // (a fact, when present), and only then the inference from the customer's
    // ticket history. Each step resolves a zid to a colaborador and falls
    // through when that person is not on equipa 360 — attribution to somebody
    // with no panel would be the same as no attribution, only harder to see.
    const candidatos: Array<[OrigemAtribuicao, number | null]> = [
      ["ticket", atrib?.zid ? (colaboradorPorZid.get(atrib.zid) ?? null) : null],
      [
        "grupo",
        porGrupo.has(c.ringoverCallId)
          ? (colaboradorPorZid.get(porGrupo.get(c.ringoverCallId) as string) ?? null)
          : null,
      ],
      [
        "chamada",
        c.ringoverUserId ? (colaboradorByRingoverId.get(c.ringoverUserId) ?? null) : null,
      ],
      [
        "historico",
        porHistorico.has(c.ringoverCallId)
          ? (colaboradorPorZid.get(porHistorico.get(c.ringoverCallId) as string) ?? null)
          : null,
      ],
    ];
    const escolhido = candidatos.find(([, id]) => id !== null);

    return {
    ringoverCallId: c.ringoverCallId,
    data: c.data,
    ticketId: atrib?.ticketId ?? null,
    colaboradorId: escolhido?.[1] ?? null,
    atribuicaoOrigem: escolhido?.[0] ?? null,
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
        atribuicaoOrigem: sql`excluded.atribuicao_origem`,
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
