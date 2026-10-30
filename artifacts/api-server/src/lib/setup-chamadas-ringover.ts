import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Cria as tabelas da Análise de Chamadas, se ainda não existirem.
 *
 * Mesma razão que `setup-painel-acessos.ts`: o deploy no Railway não corre
 * `drizzle-kit push`, e uma vista nova não pode ficar a dar erro 500 até
 * alguém aplicar o esquema à mão. Tudo é `IF NOT EXISTS`, por isso correr isto
 * a cada arranque não faz nada quando já está feito.
 */
const CRIAR_TABELAS = `
  CREATE TABLE IF NOT EXISTS "chamadas_ringover" (
    "cdr_id"          text PRIMARY KEY,
    "inicio"          timestamp with time zone NOT NULL,
    "dia"             date NOT NULL,
    "hora"            integer NOT NULL,
    "direcao"         text NOT NULL,
    "atendida"        boolean NOT NULL,
    "estado"          text,
    "duracao_s"       integer,
    "espera_s"        integer,
    "agente_id"       text,
    "agente_nome"     text,
    "cliente_numero"  text,
    "sincronizada_em" timestamp with time zone NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS "chamadas_ringover_dia_idx"
    ON "chamadas_ringover" ("dia");

  CREATE TABLE IF NOT EXISTS "chamadas_ringover_dias" (
    "dia"             date PRIMARY KEY,
    "total"           integer NOT NULL,
    "sincronizado_em" timestamp with time zone NOT NULL DEFAULT now()
  );
`;

export async function setupChamadasRingover(): Promise<boolean> {
  try {
    await pool.query(CRIAR_TABELAS);
    logger.info("análise de chamadas: tabelas prontas");
    return true;
  } catch (err) {
    logger.warn({ err }, "análise de chamadas: não foi possível preparar as tabelas");
    return false;
  }
}
