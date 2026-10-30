import { and, eq, gte, inArray, isNull, lt, lte, or, sql, desc } from "drizzle-orm";
import {
  db,
  colaboradoresTable,
  nocrmAgendaTable,
  nocrmEventosTable,
  nocrmLeadsTable,
  nocrmSyncTable,
  nocrmTagsTable,
  nocrmUsersTable,
} from "@workspace/db";
import type { EventoParsed, LeadRow } from "../nocrm/parse.js";
import type { AgendaR, EventoR, LeadR } from "../vida/regras.js";

/**
 * Acesso à base de dados do espelho do noCRM. Por CLAUDE.md, o único sítio
 * onde as tabelas `nocrm_*` são tocadas com Drizzle.
 */

const SYNC_ID = "nocrm";
const ABERTOS = ["todo", "standby"];

// ---------------------------------------------------------------- estado da sincronização

export interface EstadoSync {
  cursor: Date | null;
  ultimaCorridaEm: Date | null;
  dia: string | null;
  pedidosNoDia: number;
  ultimoResultado: unknown;
}

export async function lerEstadoSync(): Promise<EstadoSync> {
  const [r] = await db.select().from(nocrmSyncTable).where(eq(nocrmSyncTable.id, SYNC_ID));
  if (!r) return { cursor: null, ultimaCorridaEm: null, dia: null, pedidosNoDia: 0, ultimoResultado: null };
  return { cursor: r.cursor, ultimaCorridaEm: r.ultimaCorridaEm, dia: r.dia, pedidosNoDia: r.pedidosNoDia, ultimoResultado: r.ultimoResultado };
}

export async function gravarEstadoSync(e: EstadoSync): Promise<void> {
  const valores = {
    cursor: e.cursor,
    ultimaCorridaEm: e.ultimaCorridaEm,
    dia: e.dia,
    pedidosNoDia: e.pedidosNoDia,
    ultimoResultado: e.ultimoResultado,
  };
  await db
    .insert(nocrmSyncTable)
    .values({ id: SYNC_ID, ...valores })
    .onConflictDoUpdate({ target: nocrmSyncTable.id, set: valores });
}

// ---------------------------------------------------------------- utilizadores e etiquetas

export async function gravarUsers(users: { id: number; nome: string; email: string | null; admin: boolean; ativo: boolean }[]): Promise<void> {
  if (users.length === 0) return;
  await db
    .insert(nocrmUsersTable)
    .values(users.map((u) => ({ ...u, atualizadoEm: new Date() })))
    .onConflictDoUpdate({
      target: nocrmUsersTable.id,
      set: {
        nome: sql`excluded.nome`,
        email: sql`excluded.email`,
        admin: sql`excluded.admin`,
        ativo: sql`excluded.ativo`,
        atualizadoEm: sql`excluded.atualizado_em`,
      },
    });
}

/**
 * Liga cada colaborador da equipa Vida ao seu utilizador do noCRM pelo email
 * (sem diferença de maiúsculas). Só preenche quem ainda não tem ligação, para
 * não desfazer uma correcção feita à mão. Devolve quantos ligou.
 */
export async function ligarColaboradoresPorEmail(): Promise<number> {
  const r = await db.execute(sql`
    UPDATE ${colaboradoresTable} c
       SET nocrm_user_id = u.id::text
      FROM ${nocrmUsersTable} u
     WHERE c.equipa = 'vida'
       AND c.nocrm_user_id IS NULL
       AND c.email IS NOT NULL
       AND u.email IS NOT NULL
       AND lower(trim(c.email)) = lower(trim(u.email))
  `);
  return r.rowCount ?? 0;
}

export async function gravarTags(tags: { nome: string; categoria: string | null }[]): Promise<void> {
  if (tags.length === 0) return;
  // Nomes repetidos na mesma instrução fazem o Postgres recusar o upsert.
  const unicas = [...new Map(tags.map((t) => [t.nome, t])).values()];
  await db
    .insert(nocrmTagsTable)
    .values(unicas)
    .onConflictDoUpdate({ target: nocrmTagsTable.nome, set: { categoria: sql`excluded.categoria` } });
}

export async function lerCategorias(): Promise<Map<string, string | null>> {
  const rows = await db.select().from(nocrmTagsTable);
  return new Map(rows.map((r) => [r.nome, r.categoria]));
}

// ---------------------------------------------------------------- leads

export async function gravarLeads(rows: LeadRow[]): Promise<void> {
  if (rows.length === 0) return;
  const unicas = [...new Map(rows.map((r) => [r.id, r])).values()];
  await db
    .insert(nocrmLeadsTable)
    .values(unicas.map((r) => ({ ...r, sincronizadaEm: new Date() })))
    .onConflictDoUpdate({
      target: nocrmLeadsTable.id,
      set: {
        titulo: sql`excluded.titulo`,
        passo: sql`excluded.passo`,
        passoId: sql`excluded.passo_id`,
        estado: sql`excluded.estado`,
        valor: sql`excluded.valor`,
        userId: sql`excluded.user_id`,
        origem: sql`excluded.origem`,
        tags: sql`excluded.tags`,
        criadaEm: sql`excluded.criada_em`,
        atualizadaEm: sql`excluded.atualizada_em`,
        fechadaEm: sql`excluded.fechada_em`,
        proximaAcaoEm: sql`excluded.proxima_acao_em`,
        proximaAcaoDia: sql`excluded.proxima_acao_dia`,
        proximaAcaoHora: sql`excluded.proxima_acao_hora`,
        sincronizadaEm: sql`excluded.sincronizada_em`,
      },
    });
}

/**
 * Leads cujas notas e histórico estão por ler (nunca lidos, ou a lead mudou
 * desde a última leitura). Abertas primeiro, depois as mais recentes. Leads
 * fechadas há mais de `fechadasDesde` ficam de fora: não entram no painel e
 * gastariam pedidos.
 */
export async function leadsPorLerEventos(limite: number, fechadasDesde: Date): Promise<{ id: number; atualizadaEm: Date }[]> {
  if (limite <= 0) return [];
  const t = nocrmLeadsTable;
  return db
    .select({ id: t.id, atualizadaEm: t.atualizadaEm })
    .from(t)
    .where(
      and(
        or(isNull(t.eventosLidosAte), lt(t.eventosLidosAte, t.atualizadaEm)),
        or(inArray(t.estado, ABERTOS), gte(t.atualizadaEm, fechadasDesde)),
      ),
    )
    .orderBy(desc(sql`${t.estado} IN ('todo', 'standby')`), desc(t.atualizadaEm))
    .limit(limite);
}

export async function contarLeadsPorLerEventos(fechadasDesde: Date): Promise<number> {
  const t = nocrmLeadsTable;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        or(isNull(t.eventosLidosAte), lt(t.eventosLidosAte, t.atualizadaEm)),
        or(inArray(t.estado, ABERTOS), gte(t.atualizadaEm, fechadasDesde)),
      ),
    );
  return r?.n ?? 0;
}

/** Grava as notas e o histórico de uma lead e marca-a como lida até `lidosAte`. */
export async function gravarEventosDaLead(leadId: number, eventos: EventoParsed[], passoDesde: Date | null, lidosAte: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const unicos = [...new Map(eventos.map((e) => [e.id, e])).values()];
    if (unicos.length > 0) {
      await tx
        .insert(nocrmEventosTable)
        .values(unicos)
        .onConflictDoUpdate({
          target: nocrmEventosTable.id,
          set: {
            tipo: sql`excluded.tipo`,
            userId: sql`excluded.user_id`,
            ocorreuEm: sql`excluded.ocorreu_em`,
            duracaoSeg: sql`excluded.duracao_seg`,
            valor: sql`excluded.valor`,
            texto: sql`excluded.texto`,
            gravacaoUrl: sql`excluded.gravacao_url`,
          },
        });
    }
    await tx
      .update(nocrmLeadsTable)
      .set({ eventosLidosAte: lidosAte, ...(passoDesde ? { passoDesde } : {}) })
      .where(eq(nocrmLeadsTable.id, leadId));
  });
}

// ---------------------------------------------------------------- agenda

/**
 * Fotografa a agenda de `dia`: as leads abertas com próxima acção nesse dia.
 * Só acrescenta (uma lead já fotografada nesse dia fica como estava), para o
 * "previsto" não mudar quando a pessoa faz a acção e o noCRM passa a lead para
 * outro dia. Devolve quantas linhas novas entraram.
 */
export async function fotografarAgenda(dia: string): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO ${nocrmAgendaTable} (dia, lead_id, user_id, hora, passo)
    SELECT ${dia}::date, id, user_id, proxima_acao_hora, passo
      FROM ${nocrmLeadsTable}
     WHERE proxima_acao_dia = ${dia}::date
       AND estado IN ('todo', 'standby')
    ON CONFLICT (dia, lead_id) DO NOTHING
  `);
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- leitura para o painel

function paraLeadR(r: typeof nocrmLeadsTable.$inferSelect): LeadR {
  return {
    id: r.id,
    titulo: r.titulo,
    passo: r.passo,
    estado: r.estado,
    userId: r.userId,
    valor: r.valor,
    origem: r.origem,
    tags: Array.isArray(r.tags) ? r.tags : [],
    criadaEm: r.criadaEm,
    fechadaEm: r.fechadaEm,
    proximaAcaoDia: r.proximaAcaoDia,
    proximaAcaoHora: r.proximaAcaoHora,
    passoDesde: r.passoDesde,
  };
}

/** Leads abertas e as que foram criadas ou fechadas desde `desde`. */
export async function lerLeadsDoPainel(desde: Date): Promise<LeadR[]> {
  const t = nocrmLeadsTable;
  const rows = await db
    .select()
    .from(t)
    .where(or(inArray(t.estado, ABERTOS), gte(t.criadaEm, desde), gte(t.fechadaEm, desde)));
  return rows.map(paraLeadR);
}

export interface EventoPainel extends EventoR {
  id: string;
  texto: string | null;
  gravacaoUrl: string | null;
}

export async function lerEventos(params: { desde: Date; ate?: Date; userId?: number; tipos?: string[] }): Promise<EventoPainel[]> {
  const t = nocrmEventosTable;
  const conds = [gte(t.ocorreuEm, params.desde)];
  if (params.ate) conds.push(lte(t.ocorreuEm, params.ate));
  if (params.userId != null) conds.push(eq(t.userId, params.userId));
  if (params.tipos && params.tipos.length > 0) conds.push(inArray(t.tipo, params.tipos as (typeof t.tipo.enumValues)[number][]));
  const rows = await db.select().from(t).where(and(...conds)).orderBy(t.ocorreuEm);
  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    tipo: r.tipo,
    userId: r.userId,
    ocorreuEm: r.ocorreuEm,
    duracaoSeg: r.duracaoSeg,
    valor: r.valor,
    texto: r.texto,
    gravacaoUrl: r.gravacaoUrl,
  }));
}

export async function lerAgenda(de: string, ate: string): Promise<AgendaR[]> {
  const t = nocrmAgendaTable;
  const rows = await db.select().from(t).where(and(gte(t.dia, de), lte(t.dia, ate)));
  return rows.map((r) => ({ dia: r.dia, leadId: r.leadId, userId: r.userId, hora: r.hora, passo: r.passo }));
}

export interface PessoaNocrm {
  userId: number;
  nome: string;
  email: string | null;
  ativo: boolean;
  /** Está na lista da equipa Vida (colaboradores, equipa 'vida'). */
  naEquipa: boolean;
}

/** Utilizadores do noCRM, marcados com quem pertence à equipa Vida. */
export async function lerPessoas(): Promise<PessoaNocrm[]> {
  const [users, colabs] = await Promise.all([
    db.select().from(nocrmUsersTable),
    db
      .select({ nocrmUserId: colaboradoresTable.nocrmUserId, nome: colaboradoresTable.nome })
      .from(colaboradoresTable)
      .where(and(eq(colaboradoresTable.equipa, "vida"), eq(colaboradoresTable.ativo, true))),
  ]);
  const naEquipa = new Map(colabs.filter((c) => c.nocrmUserId).map((c) => [c.nocrmUserId as string, c.nome]));
  return users
    .map((u) => ({
      userId: u.id,
      nome: naEquipa.get(String(u.id)) ?? u.nome,
      email: u.email,
      ativo: u.ativo,
      naEquipa: naEquipa.has(String(u.id)),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
}

/** Colaboradores da equipa Vida sem ligação ao noCRM (email diferente ou em falta). */
export async function lerColaboradoresSemNocrm(): Promise<{ nome: string; email: string | null }[]> {
  return db
    .select({ nome: colaboradoresTable.nome, email: colaboradoresTable.email })
    .from(colaboradoresTable)
    .where(and(eq(colaboradoresTable.equipa, "vida"), eq(colaboradoresTable.ativo, true), isNull(colaboradoresTable.nocrmUserId)));
}

export async function lerTitulos(ids: number[]): Promise<Map<number, { titulo: string; passo: string | null; estado: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: nocrmLeadsTable.id, titulo: nocrmLeadsTable.titulo, passo: nocrmLeadsTable.passo, estado: nocrmLeadsTable.estado })
    .from(nocrmLeadsTable)
    .where(inArray(nocrmLeadsTable.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { titulo: r.titulo, passo: r.passo, estado: r.estado }]));
}
