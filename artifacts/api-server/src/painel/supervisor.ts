import { and, eq } from "drizzle-orm";
import { db, colaboradoresTable, type Colaborador } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { buildAgentePainel, type BlocoIndisponivel } from "./agente.js";
import { sugerirRedistribuicao, cargaPonderada, PESOS, LIMIAR_SOBRECARGA, type Sugestao } from "./redistribuicao.js";

/**
 * The supervisor's team view: totals per block, load per agent, and a
 * rule-based redistribution suggestion.
 */

export interface LinhaAgente {
  colaboradorId: number;
  nome: string;
  devolucoes: number;
  ticketsEmRisco: number;
  followUps: number;
  cargaPonderada: number;
  /** Blocks that could not be built for this agent, by name. */
  indisponiveis: string[];
}

export interface SupervisorPainel {
  data: string;
  totais: { devolucoes: number; ticketsEmRisco: number; followUps: number };
  agentes: LinhaAgente[];
  sugestao: Sugestao;
  /** Published so the UI can explain the same rule the server applied. */
  regra: { pesos: typeof PESOS; limiarSobrecarga: number };
  atualizadoEm: string;
}

function contar(bloco: unknown[] | BlocoIndisponivel): { n: number; ok: boolean } {
  return Array.isArray(bloco) ? { n: bloco.length, ok: true } : { n: 0, ok: false };
}

/**
 * Build the team view for one day.
 *
 * Reuses `buildAgentePainel` per agent rather than writing separate queries.
 * It costs more round-trips than a hand-rolled aggregate would, but it
 * guarantees the supervisor sees exactly the numbers each agent sees — a team
 * view that disagrees with the agent's own screen is worse than no team view.
 *
 * A block that fails for one agent contributes zero and is named in
 * `indisponiveis`, so a partial total is never silently passed off as complete.
 */
export async function buildSupervisorPainel(data: string): Promise<SupervisorPainel> {
  const equipa = await db
    .select()
    .from(colaboradoresTable)
    .where(and(eq(colaboradoresTable.equipa, "360"), eq(colaboradoresTable.ativo, true)));

  const linhas = await Promise.all(
    equipa.map(async (colaborador: Colaborador): Promise<LinhaAgente> => {
      const { painel, erros } = await buildAgentePainel(colaborador, data);
      for (const erro of erros) {
        logger.error(
          { err: erro, colaboradorId: colaborador.id, data },
          "painel supervisor: bloco falhou para um agente",
        );
      }

      const d = contar(painel.devolucoes);
      const t = contar(painel.ticketsEmRisco);
      const f = contar(painel.followUps);
      const indisponiveis = [
        ...(d.ok ? [] : ["devolucoes"]),
        ...(t.ok ? [] : ["ticketsEmRisco"]),
        ...(f.ok ? [] : ["followUps"]),
      ];

      const base = {
        colaboradorId: colaborador.id,
        nome: colaborador.nome,
        devolucoes: d.n,
        ticketsEmRisco: t.n,
        followUps: f.n,
      };
      return { ...base, cargaPonderada: cargaPonderada(base), indisponiveis };
    }),
  );

  // Heaviest first: the supervisor's eye should land on the problem.
  linhas.sort((a, b) => b.cargaPonderada - a.cargaPonderada || a.colaboradorId - b.colaboradorId);

  return {
    data,
    totais: {
      devolucoes: linhas.reduce((s, l) => s + l.devolucoes, 0),
      ticketsEmRisco: linhas.reduce((s, l) => s + l.ticketsEmRisco, 0),
      followUps: linhas.reduce((s, l) => s + l.followUps, 0),
    },
    agentes: linhas,
    sugestao: sugerirRedistribuicao(linhas),
    regra: { pesos: PESOS, limiarSobrecarga: LIMIAR_SOBRECARGA },
    atualizadoEm: new Date().toISOString(),
  };
}
