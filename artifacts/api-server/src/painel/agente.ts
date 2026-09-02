import type { Colaborador } from "@workspace/db";
import { VIDA_AGENT_IDS as VIDA_CONST } from "@workspace/ringover";
import { env } from "../lib/env.js";
import { listDevolucoesPendentes } from "../storage/devolucoes-repo.js";
import { listTicketsEmRisco, type TicketEmRisco } from "./tickets-risco.js";
import { loadPendingFollowUps, type FollowUpItem } from "./followups-query.js";

/**
 * The agent panel payload: what must I do today, in four blocks.
 *
 * Every block degrades on its own. An agent with no Desk identity still sees
 * their calls; a Zoho outage still leaves the follow-ups readable. A panel that
 * is 3/4 useful beats a panel that is blank.
 */

export interface DevolucaoPainel {
  /** Ids of every missed call from this number, on this day, still pending. */
  ids: number[];
  numeroCliente: string;
  /** How many times this customer called and nobody answered. */
  tentativas: number;
  /** First and last attempt, so urgency is visible without counting rows. */
  primeiraChamada: string;
  ultimaChamada: string;
  contexto: string | null;
  /** The Desk ticket n8n opened for this call, when one was matched. */
  ticketId: string | null;
}

/**
 * Collapse repeat calls from the same customer into one row.
 *
 * On a real day one customer rang five times in thirteen minutes without an
 * answer. Five rows say less than one row saying "5 tentativas" — and they bury
 * the urgency rather than showing it. The individual rows stay in the database;
 * idempotency depends on `ringover_call_id`.
 */
export function agruparDevolucoes(
  linhas: readonly {
    id: number;
    numeroCliente: string;
    numeroNormalizado: string;
    horaChamada: Date;
    contexto: string | null;
    ticketId: string | null;
  }[],
): DevolucaoPainel[] {
  const grupos = new Map<string, typeof linhas[number][]>();
  for (const l of linhas) {
    grupos.set(l.numeroNormalizado, [...(grupos.get(l.numeroNormalizado) ?? []), l]);
  }

  const out = [...grupos.values()].map((g) => {
    const ord = [...g].sort((a, b) => a.horaChamada.getTime() - b.horaChamada.getTime());
    return {
      ids: ord.map((l) => l.id),
      numeroCliente: ord[0].numeroCliente,
      tentativas: ord.length,
      primeiraChamada: ord[0].horaChamada.toISOString(),
      ultimaChamada: ord[ord.length - 1].horaChamada.toISOString(),
      // First non-empty context in the group; several attempts rarely each
      // carry one, and an empty string would read as "no context captured".
      contexto: ord.find((l) => l.contexto)?.contexto ?? null,
      // Any ticket linked to any attempt: for load accounting, one linked
      // attempt means this work is already represented in the tickets block.
      ticketId: ord.find((l) => l.ticketId)?.ticketId ?? null,
    };
  });

  // Oldest first — the customer waiting longest is at the top.
  out.sort((a, b) => new Date(a.primeiraChamada).getTime() - new Date(b.primeiraChamada).getTime());
  return out;
}

/**
 * A block that could not be built, or that has no data source yet.
 * `motivo` is written for the agent to read, in Portuguese — it goes on screen.
 */
export interface BlocoIndisponivel {
  disponivel: false;
  motivo: string;
}

export interface AgentePainel {
  colaborador: { id: number; nome: string; papel: string; equipa: string };
  data: string;
  devolucoes: DevolucaoPainel[] | BlocoIndisponivel;
  ticketsEmRisco: TicketEmRisco[] | BlocoIndisponivel;
  followUps: FollowUpItem[] | BlocoIndisponivel;
  /**
   * Always a `BlocoIndisponivel`, never an empty array. Scheduling data lives
   * in the CRM, and the CRM 360 migration has not happened — the UI must be
   * able to tell "nothing scheduled today" from "we cannot see schedules yet",
   * and today it is always the latter.
   */
  agendamentos: BlocoIndisponivel;
  atualizadoEm: string;
}

function indisponivel(motivo: string): BlocoIndisponivel {
  return { disponivel: false, motivo };
}

function buildVidaIds(): Set<number> {
  const s = new Set<number>(VIDA_CONST);
  for (const p of (env().VIDA_AGENT_IDS ?? "").split(",")) {
    const n = parseInt(p.trim(), 10);
    if (!isNaN(n)) s.add(n);
  }
  return s;
}

function buildEmailMap(): Map<number, string> {
  try {
    const parsed = JSON.parse(env().AGENT_EMAIL_MAP ?? "{}") as Record<string, string>;
    return new Map(Object.entries(parsed).map(([k, v]) => [parseInt(k, 10), v]));
  } catch {
    return new Map();
  }
}

function buildExcludedProducts(): Set<string> {
  return new Set(
    (env().FOLLOWUP_EXCLUDE_PRODUCTS ?? "TVDE,Caravela")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Build one agent's panel for one day.
 *
 * Each block is settled independently so a single failure cannot blank the
 * page. A rejected block becomes a `BlocoIndisponivel` with a sentence the
 * agent can act on, and the failure is left for the caller to log.
 */
export async function buildAgentePainel(
  colaborador: Colaborador,
  data: string,
): Promise<{ painel: AgentePainel; erros: unknown[] }> {
  const cfg = env();

  const [devolucoesR, ticketsR, followUpsR] = await Promise.allSettled([
    listDevolucoesPendentes(colaborador.id, data),

    colaborador.zid
      ? listTicketsEmRisco({ zid: colaborador.zid, orgId: cfg.ZOHO_DESK_ORG_ID })
      : Promise.resolve(null),

    colaborador.ringoverUserId
      ? loadPendingFollowUps({
          limit: 50,
          offset: 0,
          vidaIds: buildVidaIds(),
          excludedProducts: buildExcludedProducts(),
          emailMap: buildEmailMap(),
          agentRef: colaborador.ringoverUserId,
        })
      : Promise.resolve(null),
  ]);

  const erros: unknown[] = [];
  for (const r of [devolucoesR, ticketsR, followUpsR]) {
    if (r.status === "rejected") erros.push(r.reason);
  }

  const devolucoes: DevolucaoPainel[] | BlocoIndisponivel =
    devolucoesR.status === "fulfilled"
      ? agruparDevolucoes(devolucoesR.value)
      : indisponivel("Não foi possível carregar as chamadas por devolver.");

  let ticketsEmRisco: TicketEmRisco[] | BlocoIndisponivel;
  if (ticketsR.status === "rejected") {
    ticketsEmRisco = indisponivel("Não foi possível carregar os tickets.");
  } else if (ticketsR.value === null) {
    ticketsEmRisco = indisponivel(
      "Ainda não está associado a uma conta do Zoho Desk. Fala com o Nuno para ficar ligado.",
    );
  } else {
    ticketsEmRisco = ticketsR.value;
  }

  let followUps: FollowUpItem[] | BlocoIndisponivel;
  if (followUpsR.status === "rejected") {
    followUps = indisponivel("Não foi possível carregar os follow-ups.");
  } else if (followUpsR.value === null) {
    followUps = indisponivel("Ainda não está associado a um utilizador do Ringover.");
  } else {
    followUps = followUpsR.value.pending;
  }

  return {
    painel: {
      colaborador: {
        id: colaborador.id,
        nome: colaborador.nome,
        papel: colaborador.papel,
        equipa: colaborador.equipa,
      },
      data,
      devolucoes,
      ticketsEmRisco,
      followUps,
      agendamentos: indisponivel(
        "Os agendamentos ainda não estão disponíveis — vivem no CRM, que ainda não está ligado a este painel.",
      ),
      atualizadoEm: new Date().toISOString(),
    },
    erros,
  };
}
