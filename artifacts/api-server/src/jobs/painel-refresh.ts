import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { todayLisbon } from "../lib/dates.js";
import { refreshDevolucoes } from "./refresh-devolucoes.js";
import { syncTickets } from "./sync-tickets.js";

/**
 * The twice-daily panel refresh: recompute today's missed calls and re-sync
 * recent tickets.
 *
 * **This job MUST NOT call the language model.** It runs at 08:00 and 16:30
 * every working day; an LLM call here would quietly multiply the analysis
 * budget by ten. It imports neither `OpenRouterClient` nor anything that does,
 * and a test asserts exactly that — the import graph is the guarantee, not a
 * comment.
 *
 * The two halves are independent on purpose. Ringover being down must not stop
 * the tickets refreshing, and vice versa: half a refresh is worth more than
 * none, and the failure is logged either way.
 */

/** Days of ticket history to re-sync. Two covers a weekend gap or a missed run. */
export const DIAS_DE_TICKETS = 2;

export interface RefreshResult {
  data: string;
  devolucoes: { ok: true; candidatos: number; pendentes: number } | { ok: false; erro: string };
  tickets: { ok: true; ticketCount: number; commentCount: number } | { ok: false; erro: string };
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runPainelRefresh(data: string = todayLisbon()): Promise<RefreshResult> {
  const cfg = env();
  const inicio = Date.now();

  const [devolucoesR, ticketsR] = await Promise.allSettled([
    refreshDevolucoes(data),

    (async () => {
      if (
        !cfg.ZOHO_DESK_CLIENT_ID ||
        !cfg.ZOHO_DESK_CLIENT_SECRET ||
        !cfg.ZOHO_DESK_REFRESH_TOKEN ||
        !cfg.ZOHO_DESK_ORG_ID
      ) {
        throw new Error("Zoho Desk não está configurado");
      }
      const auth = new ZohoAuth({
        clientId: cfg.ZOHO_DESK_CLIENT_ID,
        clientSecret: cfg.ZOHO_DESK_CLIENT_SECRET,
        refreshToken: cfg.ZOHO_DESK_REFRESH_TOKEN,
      });
      const client = new ZohoDeskClient({ auth, orgId: cfg.ZOHO_DESK_ORG_ID });

      const to = new Date();
      const from = new Date(to.getTime() - DIAS_DE_TICKETS * 86_400_000);
      return syncTickets(client, from, to);
    })(),
  ]);

  const result: RefreshResult = {
    data,
    devolucoes:
      devolucoesR.status === "fulfilled"
        ? {
            ok: true,
            candidatos: devolucoesR.value.candidatos,
            pendentes: devolucoesR.value.pendentes,
          }
        : { ok: false, erro: mensagem(devolucoesR.reason) },
    tickets:
      ticketsR.status === "fulfilled"
        ? {
            ok: true,
            ticketCount: ticketsR.value.ticketCount,
            commentCount: ticketsR.value.commentCount,
          }
        : { ok: false, erro: mensagem(ticketsR.reason) },
  };

  if (devolucoesR.status === "rejected") {
    logger.error({ err: devolucoesR.reason, data }, "painel refresh: devoluções falharam");
  }
  if (ticketsR.status === "rejected") {
    logger.error({ err: ticketsR.reason, data }, "painel refresh: sync de tickets falhou");
  }
  logger.info({ ...result, duracaoMs: Date.now() - inicio }, "painel refresh concluído");

  return result;
}
