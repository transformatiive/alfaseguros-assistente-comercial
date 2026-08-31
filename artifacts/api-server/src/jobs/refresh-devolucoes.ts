import { RingoverClient } from "@workspace/ringover";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { lisbonDayBoundsISO, todayLisbon } from "../lib/dates.js";
import { computeDevolucoes } from "../painel/devolucoes.js";
import { upsertDevolucoes } from "../storage/devolucoes-repo.js";

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

  logger.info(
    { date, chamadas: calls.length, candidatos: candidatos.length, pendentes },
    "painel: devoluções recalculadas",
  );
  return { date, candidatos: candidatos.length, pendentes };
}
