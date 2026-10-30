import { RingoverClient, type RingoverCall } from "@workspace/ringover";
import type { InsertChamadaRingover } from "@workspace/db";
import { normalizarChamada } from "../analise-chamadas/normalizar.js";
import { lisbonDateOffset, lisbonDayBoundsISO, somarDias } from "../lib/dates.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { diasSincronizados, guardarDiaChamadas } from "../storage/chamadas-ringover-repo.js";

/**
 * Pull every Ringover call of one Lisbon day into `chamadas_ringover`.
 * Read-only on Ringover, never calls the LLM. Safe to re-run: rows upsert on
 * cdr_id, so a second pass only refreshes them.
 */
export async function sincronizarDiaChamadas(dia: string, client?: RingoverClient): Promise<number> {
  const ringover = client ?? criarCliente();
  const [start, end] = lisbonDayBoundsISO(dia);
  const calls = await ringover.listCallsBetween(start, end);
  return guardarChamadasDoDia(dia, calls);
}

/**
 * Store an already-fetched day of calls. The daily run calls this with the
 * list it pulled for the analysis, so the macro view costs no extra request.
 */
export async function guardarChamadasDoDia(dia: string, calls: readonly RingoverCall[]): Promise<number> {
  const linhas: InsertChamadaRingover[] = [];
  const vistos = new Set<string>();
  for (const call of calls) {
    const linha = normalizarChamada(call);
    // Ringover's window is inclusive at both ends; keep only this Lisbon day.
    if (!linha || linha.dia !== dia || vistos.has(linha.cdrId)) continue;
    vistos.add(linha.cdrId);
    linhas.push(linha);
  }
  await guardarDiaChamadas(dia, linhas);
  logger.info({ dia, recebidas: calls.length, guardadas: linhas.length }, "análise de chamadas: dia sincronizado");
  return linhas.length;
}

/**
 * Fill the days in [de, ate] that were never synced (or all of them when
 * `forcar`). Days run one after the other to stay gentle on Ringover's rate
 * limit; one failed day is logged and skipped, it does not stop the rest.
 */
export async function sincronizarPeriodo(
  de: string,
  ate: string,
  opts: { forcar?: boolean } = {},
): Promise<{ sincronizados: string[]; falhados: string[] }> {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  const feitos = opts.forcar ? new Set<string>() : await diasSincronizados(dias);
  const ringover = criarCliente();
  const sincronizados: string[] = [];
  const falhados: string[] = [];
  for (const dia of dias) {
    if (feitos.has(dia)) continue;
    try {
      await sincronizarDiaChamadas(dia, ringover);
      sincronizados.push(dia);
    } catch (err) {
      falhados.push(dia);
      logger.warn({ dia, err }, "análise de chamadas: falhou a sincronização do dia");
    }
  }
  return { sincronizados, falhados };
}

/** Days of history pulled automatically: the 30-day default view plus margin. */
export const DIAS_HISTORICO_AUTOMATICO = 35;

/**
 * At startup: make sure the default view has data. Pulls only the days not yet
 * synced in the last {@link DIAS_HISTORICO_AUTOMATICO} days, ending yesterday.
 */
export async function sincronizarHistoricoEmFalta(): Promise<void> {
  if (!env().RINGOVER_API_KEY) {
    logger.warn("análise de chamadas: RINGOVER_API_KEY em falta, sem sincronização");
    return;
  }
  const ate = lisbonDateOffset(-1);
  const de = lisbonDateOffset(-DIAS_HISTORICO_AUTOMATICO);
  const r = await sincronizarPeriodo(de, ate);
  logger.info({ de, ate, ...r }, "análise de chamadas: histórico em falta preenchido");
}

function criarCliente(): RingoverClient {
  const key = env().RINGOVER_API_KEY;
  if (!key) throw new Error("RINGOVER_API_KEY not configured");
  return new RingoverClient({ apiKey: key });
}
