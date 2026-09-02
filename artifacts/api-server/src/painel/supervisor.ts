import { and, eq } from "drizzle-orm";
import { db, colaboradoresTable, type Colaborador } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  buildAgentePainel,
  agruparDevolucoes,
  type BlocoIndisponivel,
  type DevolucaoPainel,
} from "./agente.js";
import { listDevolucoesNaoAtribuidas } from "../storage/devolucoes-repo.js";
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
  /**
   * Devoluções whose Desk ticket is already in this agent's tickets block.
   * Shown so the supervisor can see why the load is lower than the raw counts
   * suggest, rather than suspecting an arithmetic bug.
   */
  jaContadasComoTicket: number;
  /** Blocks that could not be built for this agent, by name. */
  indisponiveis: string[];
}

export interface SupervisorPainel {
  data: string;
  totais: { devolucoes: number; ticketsEmRisco: number; followUps: number };
  agentes: LinhaAgente[];
  /**
   * Missed calls with no agent attached — nobody answered and nobody called
   * back. Kept OUT of `totais`, which is the sum of the per-agent rows and must
   * keep reconciling with them; this is a separate pile the supervisor assigns.
   */
  naoAtribuidas: DevolucaoPainel[] | BlocoIndisponivel;
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

      // Stop counting the same work twice. Every missed call also becomes a
      // Desk ticket, so a call missed three days ago shows up BOTH as a
      // devolução and as a ticket past 24 hours. Left alone, the load formula
      // adds both and inflates the agent — and the redistribution suggestion
      // is decided on inflated numbers.
      const idsEmRisco = new Set(
        Array.isArray(painel.ticketsEmRisco) ? painel.ticketsEmRisco.map((x) => x.id) : [],
      );
      const devolucoesJaContadas = Array.isArray(painel.devolucoes)
        ? painel.devolucoes.filter((x) => x.ticketId !== null && idsEmRisco.has(x.ticketId)).length
        : 0;
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
      // The counts shown stay honest — the agent really does have `d.n`
      // devoluções. Only the LOAD drops the overlap, because load is meant to
      // measure how much work there is, not how many places it appears in.
      const carga = cargaPonderada({ ...base, devolucoes: d.n - devolucoesJaContadas });
      return { ...base, cargaPonderada: carga, jaContadasComoTicket: devolucoesJaContadas, indisponiveis };
    }),
  );

  // Heaviest first: the supervisor's eye should land on the problem.
  linhas.sort((a, b) => b.cargaPonderada - a.cargaPonderada || a.colaboradorId - b.colaboradorId);

  let naoAtribuidas: DevolucaoPainel[] | BlocoIndisponivel;
  try {
    naoAtribuidas = agruparDevolucoes(await listDevolucoesNaoAtribuidas(data));
  } catch (erro) {
    logger.error({ err: erro, data }, "painel supervisor: bloco não atribuídas falhou");
    naoAtribuidas = { disponivel: false, motivo: "Não foi possível carregar as chamadas sem agente." };
  }

  return {
    data,
    totais: {
      devolucoes: linhas.reduce((s, l) => s + l.devolucoes, 0),
      ticketsEmRisco: linhas.reduce((s, l) => s + l.ticketsEmRisco, 0),
      followUps: linhas.reduce((s, l) => s + l.followUps, 0),
    },
    agentes: linhas,
    naoAtribuidas,
    sugestao: sugerirRedistribuicao(linhas),
    regra: { pesos: PESOS, limiarSobrecarga: LIMIAR_SOBRECARGA },
    atualizadoEm: new Date().toISOString(),
  };
}
