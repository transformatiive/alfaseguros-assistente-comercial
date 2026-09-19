import { and, gte, lte } from "drizzle-orm";
import { db, painelAcessosTable, type VistaDoPainel } from "@workspace/db";
import { logger } from "../lib/logger.js";
import type { Acesso } from "../painel/adopcao.js";

/**
 * O registo de quem abriu o painel. Por CLAUDE.md, o único sítio onde esta
 * tabela é tocada com Drizzle.
 */

/**
 * Quanto tempo este processo espera antes de voltar a gravar a mesma pessoa na
 * mesma aba.
 *
 * O painel repete o pedido sempre que a pessoa regressa ao separador. Sem isto,
 * um separador aberto durante uma manhã escreve dezenas de linhas que dizem
 * todas a mesma coisa. Um minuto é muito abaixo dos trinta que separam duas
 * visitas (ver `adopcao.ts`), por isso não há nenhuma visita que se perca por
 * causa deste filtro — só se perde ruído.
 *
 * Em memória e por processo de propósito: com uma instância é exacto, e com
 * várias o pior que acontece é escrever uma linha a mais, que a leitura
 * colapsa na mesma.
 */
const SILENCIO_MS = 60_000;
const ultimoRegisto = new Map<string, number>();

/**
 * Grava que alguém abriu o painel.
 *
 * **Nunca lança e nunca atrasa a resposta.** É telemetria: se a escrita falhar,
 * o painel tem de aparecer na mesma. Perder uma linha desta tabela custa um
 * ponto num gráfico; deixar cair o painel de um agente por causa dela custa a
 * confiança toda que ele tem nisto.
 */
export function registarAcesso(colaboradorId: number, vista: VistaDoPainel): void {
  const chave = `${colaboradorId}:${vista}`;
  const agora = Date.now();
  const anterior = ultimoRegisto.get(chave);
  if (anterior !== undefined && agora - anterior < SILENCIO_MS) return;
  ultimoRegisto.set(chave, agora);
  // Travão grosseiro contra crescimento sem fim. O mapa é uma cache, não um
  // estado: esvaziá-lo custa, no máximo, uma linha repetida.
  if (ultimoRegisto.size > 5_000) ultimoRegisto.clear();

  void db
    .insert(painelAcessosTable)
    .values({ colaboradorId, vista })
    .catch((err: unknown) => {
      logger.warn({ err, colaboradorId, vista }, "painel: não foi possível registar o acesso");
    });
}

/** Os acessos de uma janela de dias de Lisboa, para a vista de adopção. */
export async function carregarAcessos(deISO: string, ateISO: string): Promise<Acesso[]> {
  const rows = await db
    .select({
      colaboradorId: painelAcessosTable.colaboradorId,
      criadoEm: painelAcessosTable.criadoEm,
      vista: painelAcessosTable.vista,
    })
    .from(painelAcessosTable)
    .where(
      and(
        gte(painelAcessosTable.criadoEm, new Date(deISO)),
        lte(painelAcessosTable.criadoEm, new Date(ateISO)),
      ),
    );

  return rows.map((r) => ({
    colaboradorId: r.colaboradorId,
    instante: r.criadoEm.toISOString(),
    vista: r.vista,
  }));
}
