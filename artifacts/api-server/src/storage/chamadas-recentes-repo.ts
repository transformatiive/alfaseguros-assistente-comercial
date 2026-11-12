import { sql } from "drizzle-orm";
import { db, chamadasRingoverTable, type InsertChamadaRingover } from "@workspace/db";

/**
 * Grava chamadas do dia corrente em `chamadas_ringover`, **sem** marcar o dia
 * como sincronizado.
 *
 * Existe por causa da caixa "Simulações sem seguimento": uma chamada atendida
 * tira a simulação da caixa, e a regra é de 2 horas. Até aqui as chamadas
 * atendidas só entravam na manhã seguinte, com a análise diária. Agora o
 * refresh de 15 em 15 minutos, que já vai buscar as chamadas do dia ao
 * Ringover para as devoluções, grava-as também.
 *
 * Não marca o dia em `chamadas_ringover_dias` de propósito: um dia gravado a
 * meio não está completo, e marcá-lo faria a sincronização de histórico
 * saltá-lo. A análise da manhã seguinte grava o dia inteiro e marca-o.
 *
 * Ficheiro à parte do `chamadas-ringover-repo` para o refresh do painel não
 * arrastar os imports da Análise de Chamadas (há um teste que vigia o grafo).
 */
const LOTE = 500;

export async function gravarChamadasRecentes(linhas: readonly InsertChamadaRingover[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += LOTE) {
    await db
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
}
