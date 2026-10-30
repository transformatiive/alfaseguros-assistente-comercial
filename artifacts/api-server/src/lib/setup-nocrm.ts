import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Cria as tabelas do espelho do noCRM e a coluna `colaboradores.nocrm_user_id`,
 * se ainda não existirem.
 *
 * Mesma razão que `setup-painel-acessos.ts`: o deploy no Railway não corre
 * `drizzle-kit push`, por isso uma tabela nova só existe em produção se o
 * próprio servidor a criar. Tudo é `IF NOT EXISTS`: correr a cada arranque não
 * faz nada quando já está feito.
 *
 * Tem de bater certo com `lib/db/src/schema/nocrm.ts`.
 *
 * A coluna em `colaboradores` vai primeiro e numa instrução própria: o Drizzle
 * passa a pedi-la em todas as leituras de colaboradores, e uma falha a criar as
 * tabelas do noCRM não pode deixar essa coluna por criar.
 */
const COLUNA_COLABORADORES = `
  ALTER TABLE "colaboradores" ADD COLUMN IF NOT EXISTS "nocrm_user_id" text;
`;

const CRIAR_TABELAS = `
  CREATE TABLE IF NOT EXISTS "nocrm_users" (
    "id"            integer PRIMARY KEY,
    "nome"          text NOT NULL,
    "email"         text,
    "admin"         boolean NOT NULL DEFAULT false,
    "ativo"         boolean NOT NULL DEFAULT true,
    "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS "nocrm_tags" (
    "nome"      text PRIMARY KEY,
    "categoria" text
  );

  CREATE TABLE IF NOT EXISTS "nocrm_leads" (
    "id"                bigint PRIMARY KEY,
    "titulo"            text NOT NULL,
    "passo"             text,
    "passo_id"          integer,
    "estado"            text NOT NULL,
    "valor"             double precision,
    "user_id"           integer,
    "origem"            text,
    "tags"              jsonb NOT NULL DEFAULT '[]'::jsonb,
    "criada_em"         timestamp with time zone NOT NULL,
    "atualizada_em"     timestamp with time zone NOT NULL,
    "fechada_em"        timestamp with time zone,
    "proxima_acao_em"   timestamp with time zone,
    "proxima_acao_dia"  date,
    "proxima_acao_hora" text,
    "passo_desde"       timestamp with time zone,
    "eventos_lidos_ate" timestamp with time zone,
    "sincronizada_em"   timestamp with time zone NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "nocrm_leads_estado_idx" ON "nocrm_leads" ("estado");
  CREATE INDEX IF NOT EXISTS "nocrm_leads_user_idx" ON "nocrm_leads" ("user_id");
  CREATE INDEX IF NOT EXISTS "nocrm_leads_proxima_dia_idx" ON "nocrm_leads" ("proxima_acao_dia");

  CREATE TABLE IF NOT EXISTS "nocrm_eventos" (
    "id"           text PRIMARY KEY,
    "lead_id"      bigint NOT NULL,
    "tipo"         text NOT NULL,
    "user_id"      integer,
    "ocorreu_em"   timestamp with time zone NOT NULL,
    "duracao_seg"  integer,
    "valor"        text,
    "texto"        text,
    "gravacao_url" text
  );
  CREATE INDEX IF NOT EXISTS "nocrm_eventos_lead_idx" ON "nocrm_eventos" ("lead_id", "ocorreu_em");
  CREATE INDEX IF NOT EXISTS "nocrm_eventos_user_idx" ON "nocrm_eventos" ("user_id", "ocorreu_em");

  CREATE TABLE IF NOT EXISTS "nocrm_agenda" (
    "dia"          date NOT NULL,
    "lead_id"      bigint NOT NULL,
    "user_id"      integer,
    "hora"         text,
    "passo"        text,
    "registada_em" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("dia", "lead_id")
  );
  CREATE INDEX IF NOT EXISTS "nocrm_agenda_user_idx" ON "nocrm_agenda" ("user_id", "dia");

  CREATE TABLE IF NOT EXISTS "nocrm_sync" (
    "id"                text PRIMARY KEY,
    "cursor"            timestamp with time zone,
    "ultima_corrida_em" timestamp with time zone,
    "dia"               date,
    "pedidos_no_dia"    integer NOT NULL DEFAULT 0,
    "ultimo_resultado"  jsonb
  );
`;

export async function setupNocrm(): Promise<void> {
  try {
    await pool.query(COLUNA_COLABORADORES);
  } catch (err) {
    logger.warn({ err }, "nocrm: não foi possível acrescentar colaboradores.nocrm_user_id");
  }
  try {
    await pool.query(CRIAR_TABELAS);
    logger.info("nocrm: tabelas prontas");
  } catch (err) {
    logger.warn({ err }, "nocrm: não foi possível preparar as tabelas");
  }
}
