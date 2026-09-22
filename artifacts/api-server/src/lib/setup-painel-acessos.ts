import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Cria a tabela dos acessos ao painel, se ainda não existir.
 *
 * ## Porque é que isto existe em vez de um `drizzle-kit push`
 *
 * O deploy no Railway corre `pnpm run build` e arranca o servidor. Não corre
 * `push` — o esquema em produção é aplicado à mão, e uma tabela nova só
 * aparece lá quando alguém se lembrar. Uma vista de analítica que fica a dar
 * erro 500 até esse dia é uma vista que ninguém chega a ver, e a primeira
 * impressão é a de que está partida.
 *
 * Não é uma invenção deste ficheiro: `setup-session-store.ts` faz exactamente
 * o mesmo, pela mesma razão, desde o início.
 *
 * ## Porque é que uma falha aqui não derruba o arranque
 *
 * Ao contrário da tabela das sessões, esta não é precisa para o produto
 * funcionar. É telemetria. Se a criação falhar — sem permissões, uma corrida
 * entre duas instâncias a arrancar ao mesmo tempo — o painel tem de continuar
 * a abrir na mesma. Fica o aviso no log e a vista de adopção diz que ainda não
 * há dados, que é verdade.
 *
 * Tudo aqui é `IF NOT EXISTS`, por isso correr isto a cada arranque não faz
 * nada quando já está feito, e duas instâncias a arrancar juntas não se
 * atropelam.
 */
const CRIAR_TABELA = `
  CREATE TABLE IF NOT EXISTS "painel_acessos" (
    "id"             serial PRIMARY KEY,
    "colaborador_id" integer NOT NULL REFERENCES "colaboradores"("id") ON DELETE CASCADE,
    "vista"          text NOT NULL,
    "criado_em"      timestamp with time zone NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS "painel_acessos_criado_em_idx"
    ON "painel_acessos" ("criado_em");

  CREATE INDEX IF NOT EXISTS "painel_acessos_colaborador_idx"
    ON "painel_acessos" ("colaborador_id", "criado_em");
`;

export async function setupPainelAcessos(): Promise<void> {
  try {
    await pool.query(CRIAR_TABELA);
    logger.info("painel: tabela de acessos pronta");
  } catch (err) {
    logger.warn({ err }, "painel: não foi possível preparar a tabela de acessos");
  }
}
