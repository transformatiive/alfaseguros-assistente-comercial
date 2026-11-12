import { RingoverClient } from "@workspace/ringover";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { lisbonDayBoundsISO, todayLisbon } from "../lib/dates.js";
import { computeDevolucoes } from "../painel/devolucoes.js";
import { upsertDevolucoes } from "../storage/devolucoes-repo.js";
import { gravarChamadasRecentes } from "../storage/chamadas-recentes-repo.js";
import { normalizarChamada } from "../analise-chamadas/normalizar.js";

/**
 * Recompute "chamadas por devolver" for one Lisbon day and persist them.
 *
 * Costs nothing beyond the Ringover call: no LLM is involved, by design. The
 * panel refreshes twice a day and must never touch the analysis budget.
 *
 * Safe to run repeatedly — `upsertDevolucoes` refreshes only rows still
 * `pendente`, so an agent's resolved work is never resurrected.
 */
export async function refreshDevolucoes(
  date: string = todayLisbon(),
): Promise<{ date: string; candidatos: number; pendentes: number }> {
  const cfg = env();
  if (!cfg.RINGOVER_API_KEY) throw new Error("RINGOVER_API_KEY não está configurado");

  const ringover = new RingoverClient({ apiKey: cfg.RINGOVER_API_KEY });
  const [start, end] = lisbonDayBoundsISO(date);
  const calls = await ringover.listCallsBetween(start, end);

  const candidatos = computeDevolucoes(calls, date);
  const pendentes = candidatos.filter((c) => c.estado === "pendente").length;
  await upsertDevolucoes(candidatos);

  // As mesmas chamadas, guardadas para a caixa "Simulações sem seguimento"
  // (uma chamada atendida tira a simulação da caixa). Uma falha aqui não
  // pode estragar as devoluções, que já estão gravadas.
  try {
    const vistos = new Set<string>();
    const linhas = calls.flatMap((c) => {
      const l = normalizarChamada(c);
      if (!l || l.dia !== date || vistos.has(l.cdrId)) return [];
      vistos.add(l.cdrId);
      return [l];
    });
    await gravarChamadasRecentes(linhas);
  } catch (err) {
    logger.warn({ err, date }, "painel: não foi possível guardar as chamadas do dia");
  }

  logger.info(
    { date, chamadas: calls.length, candidatos: candidatos.length, pendentes },
    "painel: devoluções recalculadas",
  );
  return { date, candidatos: candidatos.length, pendentes };
}
