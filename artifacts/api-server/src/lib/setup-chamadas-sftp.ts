import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Cria as tabelas da Análise de Chamadas Vida (gravações do SFTP), se ainda não
 * existirem. Mesma razão que `setup-painel-acessos.ts`: o deploy não corre
 * `drizzle-kit push`, e um menu novo que dá erro 500 até alguém aplicar o
 * esquema à mão é um menu que parece partido.
 *
 * Tudo `IF NOT EXISTS`: correr a cada arranque não faz nada quando já está
 * feito. Tem de bater certo com `lib/db/src/schema/chamadas_sftp.ts`.
 */
const CRIAR_TABELAS = `
  CREATE TABLE IF NOT EXISTS "chamadas_sftp" (
    "id"              serial PRIMARY KEY,
    "ficheiro"        text NOT NULL,
    "data_hora"       timestamp with time zone NOT NULL,
    "telefone"        text,
    "tamanho_bytes"   integer NOT NULL DEFAULT 0,
    "duracao_s"       real,
    "estado"          text NOT NULL DEFAULT 'pendente',
    "colaborador"     text NOT NULL DEFAULT 'Colaborador Vida',
    "tipo"            text,
    "resumo"          text,
    "desfecho"        text,
    "objecoes"        jsonb,
    "motivo_descarte" text,
    "erro"            text,
    "modelo"          text,
    "custo_usd"       real,
    "analisada_em"    timestamp with time zone,
    "criado_em"       timestamp with time zone NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "chamadas_sftp_ficheiro_uniq" ON "chamadas_sftp" ("ficheiro");
  CREATE INDEX IF NOT EXISTS "chamadas_sftp_data_idx" ON "chamadas_sftp" ("data_hora");

  CREATE TABLE IF NOT EXISTS "chamadas_sftp_resultados" (
    "id"         serial PRIMARY KEY,
    "chamada_id" integer NOT NULL REFERENCES "chamadas_sftp"("id") ON DELETE CASCADE,
    "item"       text NOT NULL,
    "estado"     text NOT NULL,
    "confianca"  real NOT NULL DEFAULT 1,
    "rever"      boolean NOT NULL DEFAULT false,
    "evidencia"  text
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "chamadas_sftp_resultados_chamada_item_uniq"
    ON "chamadas_sftp_resultados" ("chamada_id", "item");
  CREATE INDEX IF NOT EXISTS "chamadas_sftp_resultados_item_idx" ON "chamadas_sftp_resultados" ("item");

  CREATE TABLE IF NOT EXISTS "chamadas_sftp_destaques" (
    "id"          serial PRIMARY KEY,
    "periodo_de"  text NOT NULL,
    "periodo_ate" text NOT NULL,
    "conteudo"    jsonb NOT NULL,
    "modelo"      text,
    "gerado_em"   timestamp with time zone NOT NULL DEFAULT now()
  );
`;

export async function setupChamadasSftp(): Promise<void> {
  try {
    await pool.query(CRIAR_TABELAS);
    logger.info("chamadas-sftp: tabelas prontas");
  } catch (err) {
    logger.warn({ err }, "chamadas-sftp: não foi possível preparar as tabelas");
  }
}
