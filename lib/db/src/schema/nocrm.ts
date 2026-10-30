import {
  pgTable,
  integer,
  bigint,
  text,
  boolean,
  date,
  timestamp,
  doublePrecision,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * Espelho de leitura do noCRM, a ferramenta de pipeline da equipa Vida.
 *
 * Nada aqui é escrito de volta no noCRM. As tabelas existem porque a API só
 * deixa 2.000 pedidos por dia e as notas e o histórico só se leem lead a lead:
 * o painel lê daqui, e a sincronização (`jobs/sync-nocrm.ts`) traz só o que
 * mudou.
 *
 * As tabelas são criadas no arranque por `lib/setup-nocrm.ts` (o Railway não
 * corre `drizzle-kit push`). Uma coluna nova aqui tem de ir também para lá.
 */

/** Utilizadores do noCRM. `id` é o id do noCRM. */
export const nocrmUsersTable = pgTable("nocrm_users", {
  id: integer("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email"),
  admin: boolean("admin").notNull().default(false),
  ativo: boolean("ativo").notNull().default(true),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** Etiquetas predefinidas e a sua categoria (Origem da Lead, Motivo Perdido, ...). */
export const nocrmTagsTable = pgTable("nocrm_tags", {
  nome: text("nome").primaryKey(),
  categoria: text("categoria"),
});

/**
 * Uma lead do noCRM, no estado da última leitura.
 *
 * `passoDesde` é quando a lead entrou no passo actual, tirado do histórico.
 * Fica nulo enquanto o histórico da lead não foi lido; as regras usam então a
 * data de criação como limite inferior.
 */
export const nocrmLeadsTable = pgTable(
  "nocrm_leads",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    titulo: text("titulo").notNull(),
    passo: text("passo"),
    passoId: integer("passo_id"),
    estado: text("estado").notNull(),
    valor: doublePrecision("valor"),
    userId: integer("user_id"),
    origem: text("origem"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull(),
    atualizadaEm: timestamp("atualizada_em", { withTimezone: true }).notNull(),
    fechadaEm: timestamp("fechada_em", { withTimezone: true }),
    proximaAcaoEm: timestamp("proxima_acao_em", { withTimezone: true }),
    proximaAcaoDia: date("proxima_acao_dia"),
    proximaAcaoHora: text("proxima_acao_hora"),
    passoDesde: timestamp("passo_desde", { withTimezone: true }),
    /** `atualizadaEm` da lead quando as notas e o histórico foram lidos. */
    eventosLidosAte: timestamp("eventos_lidos_ate", { withTimezone: true }),
    sincronizadaEm: timestamp("sincronizada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("nocrm_leads_estado_idx").on(t.estado),
    index("nocrm_leads_user_idx").on(t.userId),
    index("nocrm_leads_proxima_dia_idx").on(t.proximaAcaoDia),
  ],
);

/**
 * O que aconteceu numa lead: notas, chamadas (o Ringover escreve-as como
 * notas), emails e mudanças no histórico. `id` é "c:<id da nota>" ou
 * "h:<id do histórico>", para as duas fontes não colidirem.
 */
export const nocrmEventosTable = pgTable(
  "nocrm_eventos",
  {
    id: text("id").primaryKey(),
    leadId: bigint("lead_id", { mode: "number" }).notNull(),
    tipo: text("tipo", {
      enum: ["chamada", "nota", "email", "passo", "estado", "dono", "criada", "outro"],
    }).notNull(),
    userId: integer("user_id"),
    ocorreuEm: timestamp("ocorreu_em", { withTimezone: true }).notNull(),
    /** Só chamadas. 0 = tentativa sem conversa. */
    duracaoSeg: integer("duracao_seg"),
    /** Nome do passo ou do estado, para eventos do histórico. */
    valor: text("valor"),
    texto: text("texto"),
    gravacaoUrl: text("gravacao_url"),
  },
  (t) => [
    index("nocrm_eventos_lead_idx").on(t.leadId, t.ocorreuEm),
    index("nocrm_eventos_user_idx").on(t.userId, t.ocorreuEm),
  ],
);

/**
 * A agenda de cada dia: as leads cuja próxima acção caía nesse dia, tal como
 * estavam na primeira leitura do dia. Guardada porque, mal a pessoa faz a
 * acção, o noCRM passa a próxima acção para outro dia e o "previsto" perde-se.
 * Só se acrescenta, nunca se apaga.
 */
export const nocrmAgendaTable = pgTable(
  "nocrm_agenda",
  {
    dia: date("dia").notNull(),
    leadId: bigint("lead_id", { mode: "number" }).notNull(),
    userId: integer("user_id"),
    hora: text("hora"),
    passo: text("passo"),
    registadaEm: timestamp("registada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dia, t.leadId] }), index("nocrm_agenda_user_idx").on(t.userId, t.dia)],
);

/** Estado da sincronização: uma linha, `id = 'nocrm'`. */
export const nocrmSyncTable = pgTable("nocrm_sync", {
  id: text("id").primaryKey(),
  cursor: timestamp("cursor", { withTimezone: true }),
  ultimaCorridaEm: timestamp("ultima_corrida_em", { withTimezone: true }),
  dia: date("dia"),
  pedidosNoDia: integer("pedidos_no_dia").notNull().default(0),
  ultimoResultado: jsonb("ultimo_resultado"),
});

export type NocrmLead = typeof nocrmLeadsTable.$inferSelect;
export type NocrmEvento = typeof nocrmEventosTable.$inferSelect;
export type NocrmUser = typeof nocrmUsersTable.$inferSelect;
export type NocrmAgenda = typeof nocrmAgendaTable.$inferSelect;
