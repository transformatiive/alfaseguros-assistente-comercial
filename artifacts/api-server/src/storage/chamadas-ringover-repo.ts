import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  caseCallsTable,
  caseTicketsTable,
  conversationsTable,
  chamadasRingoverTable,
  chamadasRingoverDiasTable,
  colaboradoresTable,
  type InsertChamadaRingover,
} from "@workspace/db";
import type { EquipaColaborador } from "../analise-chamadas/agregar.js";
import type { ConversaPara360 } from "../analise-chamadas/agregar-360.js";

/**
 * Storage for the Análise de Chamadas tables. Per CLAUDE.md this is the only
 * place Drizzle touches `chamadas_ringover` / `chamadas_ringover_dias`.
 */

const LOTE = 500;

/** Upsert a day's calls (idempotent on cdr_id) and mark the day as synced. */
export async function guardarDiaChamadas(dia: string, linhas: InsertChamadaRingover[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < linhas.length; i += LOTE) {
      await tx
        .insert(chamadasRingoverTable)
        .values(linhas.slice(i, i + LOTE))
        .onConflictDoUpdate({
          target: chamadasRingoverTable.cdrId,
          set: {
            inicio: sql`excluded.inicio`,
            dia: sql`excluded.dia`,
            hora: sql`excluded.hora`,
            direcao: sql`excluded.direcao`,
            atendida: sql`excluded.atendida`,
            estado: sql`excluded.estado`,
            duracaoS: sql`excluded.duracao_s`,
            esperaS: sql`excluded.espera_s`,
            agenteId: sql`excluded.agente_id`,
            agenteNome: sql`excluded.agente_nome`,
            clienteNumero: sql`excluded.cliente_numero`,
            sincronizadaEm: sql`now()`,
          },
        });
    }
    await tx
      .insert(chamadasRingoverDiasTable)
      .values({ dia, total: linhas.length })
      .onConflictDoUpdate({
        target: chamadasRingoverDiasTable.dia,
        set: { total: linhas.length, sincronizadoEm: sql`now()` },
      });
  });
}

/** Which of these days have already been pulled from Ringover. */
export async function diasSincronizados(dias: string[]): Promise<Set<string>> {
  if (dias.length === 0) return new Set();
  const rows = await db
    .select({ dia: chamadasRingoverDiasTable.dia })
    .from(chamadasRingoverDiasTable)
    .where(inArray(chamadasRingoverDiasTable.dia, dias));
  return new Set(rows.map((r) => r.dia));
}

/** First and last synced day — tells the page how far back data goes. */
export async function limitesSincronizados(): Promise<{ primeiro: string | null; ultimo: string | null }> {
  const [r] = await db
    .select({
      primeiro: sql<string | null>`min(${chamadasRingoverDiasTable.dia})::text`,
      ultimo: sql<string | null>`max(${chamadasRingoverDiasTable.dia})::text`,
    })
    .from(chamadasRingoverDiasTable);
  return { primeiro: r?.primeiro ?? null, ultimo: r?.ultimo ?? null };
}

export async function carregarChamadasPeriodo(de: string, ate: string) {
  return db
    .select({
      dia: chamadasRingoverTable.dia,
      hora: chamadasRingoverTable.hora,
      direcao: chamadasRingoverTable.direcao,
      atendida: chamadasRingoverTable.atendida,
      estado: chamadasRingoverTable.estado,
      duracaoS: chamadasRingoverTable.duracaoS,
      esperaS: chamadasRingoverTable.esperaS,
      agenteId: chamadasRingoverTable.agenteId,
      agenteNome: chamadasRingoverTable.agenteNome,
      clienteNumero: chamadasRingoverTable.clienteNumero,
    })
    .from(chamadasRingoverTable)
    .where(and(gte(chamadasRingoverTable.dia, de), lte(chamadasRingoverTable.dia, ate)))
    .orderBy(asc(chamadasRingoverTable.inicio));
}

/** Ringover user_id → equipa, for every active colaborador that has one. */
export async function carregarRosterEquipas(): Promise<Map<string, EquipaColaborador>> {
  const rows = await db
    .select({ id: colaboradoresTable.ringoverUserId, equipa: colaboradoresTable.equipa })
    .from(colaboradoresTable)
    .where(isNotNull(colaboradoresTable.ringoverUserId));
  return new Map(rows.filter((r) => r.id).map((r) => [r.id as string, r.equipa]));
}

/**
 * Analysed conversations of a period with the Desk case each one belongs to.
 * A conversation linked to several cases keeps the one that has a ticket.
 * Team filtering happens in the caller (it needs the roster).
 */
export async function carregarConversasComCaso(de: string, ate: string): Promise<ConversaPara360[]> {
  const temTicket = sql<boolean>`exists (select 1 from ${caseTicketsTable} where ${caseTicketsTable.caseId} = ${casesTable.id})`;
  const rows = await db
    .select({
      id: conversationsTable.id,
      dia: conversationsTable.runDate,
      agenteId: conversationsTable.agentId,
      agenteNome: conversationsTable.agentName,
      analise: conversationsTable.analysisJson,
      resultado: casesTable.outcomeStatus,
      temTicket,
    })
    .from(conversationsTable)
    .leftJoin(caseCallsTable, eq(caseCallsTable.conversationId, conversationsTable.id))
    .leftJoin(casesTable, eq(casesTable.id, caseCallsTable.caseId))
    .where(and(gte(conversationsTable.runDate, de), lte(conversationsTable.runDate, ate)))
    .orderBy(asc(conversationsTable.id));

  const porId = new Map<number, ConversaPara360>();
  for (const r of rows) {
    const atual = porId.get(r.id);
    const linha: ConversaPara360 = { ...r, temTicket: r.temTicket === true };
    if (!atual || (!atual.temTicket && linha.temTicket)) porId.set(r.id, linha);
  }
  return [...porId.values()];
}
