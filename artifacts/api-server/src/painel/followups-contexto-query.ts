import { and, eq, gte, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { db, colaboradoresTable, conversationsTable, ticketsTable } from "@workspace/db";
import type { FollowUpItem } from "./followups-shape.js";
import {
  DIAS_ANTES_DA_CHAMADA,
  descreverFecho,
  eDeQuem,
  estadoDoNegocio,
  inicioDaChamada,
  lerContexto,
  numerosCitados,
  type TicketDeContexto,
} from "./followups-contexto.js";
import { impressaoDigital } from "./tarefas.js";
import { deOutroDepartamento, emailDoTicket, telefoneDoTicket } from "./tickets-risco.js";

/** O campo "Telefone" do ticket, reduzido aos últimos nove dígitos, em SQL. */
const TELEFONE_DO_TICKET_SQL = sql`right(regexp_replace(coalesce(${ticketsTable.rawJson}->>'phone', ''), '[^0-9]', '', 'g'), 9)`;

/** O email do ticket ou do contacto, em minúsculas, em SQL. Igual a `emailDoTicket`. */
const EMAIL_DO_TICKET_SQL = sql`lower(coalesce(nullif(trim(${ticketsTable.rawJson}->>'email'), ''), trim(${ticketsTable.rawJson}->'contact'->>'email')))`;

const COLUNAS_DO_TICKET = {
  id: ticketsTable.id,
  ticketNumber: ticketsTable.ticketNumber,
  statusType: ticketsTable.statusType,
  assigneeId: ticketsTable.assigneeId,
  phoneFingerprint: ticketsTable.phoneFingerprint,
  createdTime: ticketsTable.createdTime,
  closedTime: ticketsTable.closedTime,
  customFieldsJson: ticketsTable.customFieldsJson,
  rawJson: ticketsTable.rawJson,
};

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

  const [conversas, equipa] = await Promise.all([
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
    db
      .select({ zid: colaboradoresTable.zid })
      .from(colaboradoresTable)
      .where(and(eq(colaboradoresTable.ativo, true), isNotNull(colaboradoresTable.zid))),
  ]);

  const chamadaPorConversa = new Map<number, string>();
  for (const c of conversas) chamadaPorConversa.set(c.id, inicioDaChamada(c.legsJson, c.runDate));

  // Os tickets pelo telefone do ticket e pelo email só se procuram até 60
  // dias (mais um, pela hora de Lisboa) antes da chamada mais antiga: são
  // pesquisas dentro do JSON do Desk, sem índice.
  const instantes = [...chamadaPorConversa.values()].map((iso) => Date.parse(iso));
  const limite =
    instantes.length > 0
      ? new Date(Math.min(...instantes) - (DIAS_ANTES_DA_CHAMADA + 1) * 86_400_000)
      : null;

  const condicoes = [
    fingerprints.length > 0 ? inArray(ticketsTable.phoneFingerprint, fingerprints) : undefined,
    fingerprints.length > 0 && limite
      ? and(gte(ticketsTable.createdTime, limite), inArray(TELEFONE_DO_TICKET_SQL, fingerprints))
      : undefined,
    numeros.length > 0 ? inArray(ticketsTable.ticketNumber, numeros) : undefined,
    ligados.length > 0 ? inArray(ticketsTable.id, ligados) : undefined,
  ].filter((c) => c !== undefined);

  const primeiros =
    condicoes.length === 0
      ? []
      : await db.select(COLUNAS_DO_TICKET).from(ticketsTable).where(or(...condicoes));

  // Os emails que o Desk associa a cada número. Ligam os tickets que chegaram
  // por email, com o telefone de um parceiro ou sem telefone.
  const emailsPorFingerprint = new Map<string, Set<string>>();
  for (const t of primeiros) {
    const email = emailDoTicket(t.rawJson)?.toLowerCase();
    if (!email) continue;
    for (const fp of [t.phoneFingerprint, telefoneDoTicket(t.rawJson)]) {
      if (!fp) continue;
      const set = emailsPorFingerprint.get(fp) ?? new Set<string>();
      set.add(email);
      emailsPorFingerprint.set(fp, set);
    }
  }
  const emails = [...new Set([...emailsPorFingerprint.values()].flatMap((s) => [...s]))];
  const jaLidos = primeiros.map((t) => t.id);
  const porEmail =
    emails.length > 0 && limite
      ? await db
          .select(COLUNAS_DO_TICKET)
          .from(ticketsTable)
          .where(
            and(
              gte(ticketsTable.createdTime, limite),
              inArray(EMAIL_DO_TICKET_SQL, emails),
              jaLidos.length > 0 ? notInArray(ticketsTable.id, jaLidos) : undefined,
            ),
          )
      : [];

  // A Corporate e a Contratação Pública não entram no painel da equipa 360:
  // nem para mostrar, nem para segurar ou fechar uma promessa.
  const deFora = new Set<string>();
  const tickets: TicketDeContexto[] = [];
  for (const t of [...primeiros, ...porEmail]) {
    if (deOutroDepartamento(t.rawJson)) {
      deFora.add(t.id);
      continue;
    }
    tickets.push({
      id: t.id,
      ticketNumber: t.ticketNumber,
      statusType: t.statusType,
      assigneeId: t.assigneeId,
      phoneFingerprint: t.phoneFingerprint,
      telefoneDoTicket: telefoneDoTicket(t.rawJson),
      email: emailDoTicket(t.rawJson)?.toLowerCase() ?? null,
      createdTime: t.createdTime ? t.createdTime.toISOString() : null,
      closedTime: t.closedTime ? t.closedTime.toISOString() : null,
      estadoNegocio: estadoDoNegocio(t.customFieldsJson),
    });
  }
  const zidsDaEquipa = new Set(equipa.map((e) => e.zid).filter((z): z is string => !!z));

  const abertos: FollowUpComContexto[] = [];
  const fechados: FollowUpFechado[] = [];

  for (const f of todos) {
    const convId = idDaConversa(f.id);
    const chamadaEm = (convId !== null && chamadaPorConversa.get(convId)) || null;
    const fingerprint = impressaoDigital(f.contact_phone);
    // Um ticket da Corporate ligado pelos casos é como não haver ligação.
    const ligado = f.linked_ticket_id && !deFora.has(f.linked_ticket_id) ? f.linked_ticket_id : null;
    const ctx = lerContexto(
      {
        linkedTicketId: ligado,
        descricao: f.follow_up_descricao,
        fingerprint,
        chamadaEm,
        emails: fingerprint ? emailsPorFingerprint.get(fingerprint) : undefined,
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
      linked_ticket_id: ctx.principal?.id ?? ligado,
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
