import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db, colaboradoresTable, conversationsTable, ticketsTable } from "@workspace/db";
import type { FollowUpItem } from "./followups-shape.js";
import {
  descreverFecho,
  eDeQuem,
  inicioDaChamada,
  lerContexto,
  numerosCitados,
  type TicketDeContexto,
} from "./followups-contexto.js";
import { impressaoDigital } from "./tarefas.js";

/** Uma promessa com o que o Desk sabe dela. */
export interface FollowUpComContexto extends FollowUpItem {
  /** ISO da chamada onde a promessa foi feita. */
  chamada_em: string | null;
  /** Número do ticket que a linha mostra, como no Desk. */
  ticket_numero: string | null;
}

/** Uma promessa que saiu porque o ticket fechou. */
export interface FollowUpFechado {
  item: FollowUpComContexto;
  descricao: string;
  /** ISO de quando o ticket fechou, para mostrar só os fechos recentes. */
  fechadoEm: string | null;
}

function idDaConversa(id: string): number | null {
  const n = parseInt(id.replace(/^conv_/, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Lê, para as promessas de toda a equipa, a hora da chamada e os tickets do
 * cliente, e devolve só as deste colaborador — separadas entre as que
 * continuam abertas e as que o Desk já fechou.
 *
 * Recebe as promessas de **todos** os agentes, e não só as de quem atendeu,
 * porque uma promessa cujo ticket passou para outra pessoa tem de aparecer no
 * painel dessa pessoa.
 */
export async function carregarContextoDosFollowUps(
  todos: readonly FollowUpItem[],
  colaborador: { zid: string | null; ringoverUserId: string | null },
): Promise<{ abertos: FollowUpComContexto[]; fechados: FollowUpFechado[] }> {
  if (todos.length === 0) return { abertos: [], fechados: [] };

  const convIds = todos.map((f) => idDaConversa(f.id)).filter((n): n is number => n !== null);
  const fingerprints = [
    ...new Set(todos.map((f) => impressaoDigital(f.contact_phone)).filter((x): x is string => !!x)),
  ];
  const numeros = [...new Set(todos.flatMap((f) => numerosCitados(f.follow_up_descricao)))];
  const ligados = [...new Set(todos.map((f) => f.linked_ticket_id).filter((x): x is string => !!x))];

  const condicoes = [
    fingerprints.length > 0 ? inArray(ticketsTable.phoneFingerprint, fingerprints) : undefined,
    numeros.length > 0 ? inArray(ticketsTable.ticketNumber, numeros) : undefined,
    ligados.length > 0 ? inArray(ticketsTable.id, ligados) : undefined,
  ].filter((c) => c !== undefined);

  const [conversas, linhasTickets, equipa] = await Promise.all([
    convIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: conversationsTable.id,
            runDate: conversationsTable.runDate,
            legsJson: conversationsTable.legsJson,
          })
          .from(conversationsTable)
          .where(inArray(conversationsTable.id, convIds)),
    condicoes.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: ticketsTable.id,
            ticketNumber: ticketsTable.ticketNumber,
            statusType: ticketsTable.statusType,
            assigneeId: ticketsTable.assigneeId,
            phoneFingerprint: ticketsTable.phoneFingerprint,
            createdTime: ticketsTable.createdTime,
            closedTime: ticketsTable.closedTime,
          })
          .from(ticketsTable)
          .where(or(...condicoes)),
    db
      .select({ zid: colaboradoresTable.zid })
      .from(colaboradoresTable)
      .where(and(eq(colaboradoresTable.ativo, true), isNotNull(colaboradoresTable.zid))),
  ]);

  const chamadaPorConversa = new Map<number, string>();
  for (const c of conversas) chamadaPorConversa.set(c.id, inicioDaChamada(c.legsJson, c.runDate));

  const tickets: TicketDeContexto[] = linhasTickets.map((t) => ({
    id: t.id,
    ticketNumber: t.ticketNumber,
    statusType: t.statusType,
    assigneeId: t.assigneeId,
    phoneFingerprint: t.phoneFingerprint,
    createdTime: t.createdTime ? t.createdTime.toISOString() : null,
    closedTime: t.closedTime ? t.closedTime.toISOString() : null,
  }));
  const zidsDaEquipa = new Set(equipa.map((e) => e.zid).filter((z): z is string => !!z));

  const abertos: FollowUpComContexto[] = [];
  const fechados: FollowUpFechado[] = [];

  for (const f of todos) {
    const convId = idDaConversa(f.id);
    const chamadaEm = (convId !== null && chamadaPorConversa.get(convId)) || null;
    const ctx = lerContexto(
      {
        linkedTicketId: f.linked_ticket_id,
        descricao: f.follow_up_descricao,
        fingerprint: impressaoDigital(f.contact_phone),
        chamadaEm,
      },
      tickets,
    );

    if (
      !eDeQuem({
        dono: ctx.dono,
        agenteDaChamada: f.agent_ref,
        zidsDaEquipa,
        colaborador,
      })
    ) {
      continue;
    }

    const item: FollowUpComContexto = {
      ...f,
      linked_ticket_id: ctx.principal?.id ?? f.linked_ticket_id,
      chamada_em: chamadaEm,
      ticket_numero: ctx.principal?.ticketNumber ?? null,
    };

    if (ctx.fechadoPor) fechados.push({
        item,
        descricao: descreverFecho(ctx.fechadoPor),
        fechadoEm: ctx.fechadoPor.closedTime,
      });
    else abertos.push(item);
  }

  return { abertos, fechados };
}
