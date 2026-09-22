import { eq, inArray } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketCommentsTable,
  ticketSyncStateTable,
} from "@workspace/db";
import { ZohoDeskClient, type ZohoComment, type ZohoTicket } from "@workspace/zoho-desk";
import { phoneFingerprint } from "@workspace/phone";
import { classifyOutcome } from "../analysis/outcome.js";
import { sanitizeCommentContent } from "../cases/linker.js";
import { logger } from "../lib/logger.js";

export interface SyncResult {
  ticketCount: number;
  commentCount: number;
  /** All tickets fetched in this sync (used by the case linker downstream). */
  tickets: ZohoTicket[];
  /** All comments fetched (each carries `ticketId` from the upstream context). */
  comments: Array<ZohoComment & { ticketId: string }>;
}

/**
 * Puxa do Zoho Desk os tickets **modificados** desde `from`, com as respectivas
 * conversas, e guarda-os. Idempotente: repetir a mesma janela é seguro.
 *
 * ## Modificados, e não criados
 *
 * Isto lia tickets *criados* na janela, e daí vinha um erro que não era óbvio:
 * os comentários de um ticket eram lidos uma única vez, poucas horas depois de
 * ele nascer — quando ainda não tinha resposta nenhuma. A resposta do agente
 * chega depois e nunca era guardada.
 *
 * O estrago maior não era a métrica de primeira resposta. Era o painel: a
 * prova que faz uma tarefa desaparecer *é* uma resposta no ticket. Sem ela, um
 * agente que responde a um pedido de anteontem continua a vê-lo na lista como
 * se nada tivesse feito — e a desconfiar do painel, com razão.
 *
 * Um comentário novo altera o `modifiedTime`. Perguntar pelos modificados
 * apanha por construção tudo o que mexeu, incluindo tickets antigos que
 * ganharam resposta hoje.
 *
 * O `to` deixou de servir para filtrar — um ticket modificado *agora* está
 * sempre dentro da janela que interessa, e um limite superior só serviria para
 * o excluir. Continua a ser gravado em `ticket_sync_state` como a ponta
 * superior da janela que esta corrida cobriu.
 */
/**
 * Uma corrida que ignora o "já vi este ticket" e relê tudo.
 *
 * Serve uma vez só, e por uma razão precisa: a sincronização passou a ler
 * `/conversations` em vez de `/comments`, ou seja, passou a ver os emails
 * enviados aos clientes, que antes eram invisíveis. Mas o salto por
 * `modifiedTime` está desenhado para não repetir trabalho — e de um ticket já
 * sincronizado ele acha que já sabe tudo. **Sem isto, a correcção só apanha
 * tickets que voltem a mexer**, e os pedidos que o Tiago reportou podiam nunca
 * mais mexer.
 *
 * `SYNC_RELER_CONVERSAS=1`, esperar uma corrida, e **retirar a variável**.
 * Deixada lá, relê tudo de quinze em quinze minutos e queima a quota da Zoho
 * sem necessidade — é o mesmo cuidado que o `AGENDA_RETOMAR_DIA` pede.
 */
export function releituraPedida(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYNC_RELER_CONVERSAS === "1";
}

export async function syncTickets(
  client: ZohoDeskClient,
  from: Date,
  to: Date,
): Promise<SyncResult> {
  const tickets = await client.listTicketsModifiedSince({
    modifiedTimeFrom: from.toISOString(),
  });

  /*
   * O que já sabíamos de cada um destes tickets.
   *
   * Isto existe por causa da quota, e a quota passou a importar precisamente
   * por causa da mudança acima. Antes, uma janela de duas horas trazia os
   * poucos tickets *criados* nela. Agora traz todos os que *mexeram* — e cada
   * um custa uma chamada à API para ir buscar os comentários.
   *
   * Um ticket cujo `modifiedTime` é igual ao que temos guardado não mudou
   * desde a última vez que o lemos, por isso os comentários dele também não.
   * Saltar essa chamada torna a janela larga de dois dias barata a partir da
   * segunda corrida, que é quando ela seria cara.
   *
   * O ticket em si é sempre gravado, mesmo quando os comentários são saltados:
   * é um upsert idempotente e custa zero chamadas à Zoho.
   */
  const conhecidos = new Map<string, number>();
  const reler = releituraPedida();
  if (reler) {
    logger.warn(
      { tickets: tickets.length },
      "sync-tickets: SYNC_RELER_CONVERSAS está ligado — a reler as conversas todas. Retirar a variável depois desta corrida.",
    );
  }
  if (!reler && tickets.length > 0) {
    for (const linha of await db
      .select({ id: ticketsTable.id, modifiedTime: ticketsTable.modifiedTime })
      .from(ticketsTable)
      .where(inArray(ticketsTable.id, tickets.map((t) => t.id)))) {
      if (linha.modifiedTime) conhecidos.set(linha.id, linha.modifiedTime.getTime());
    }
  }

  const allComments: Array<ZohoComment & { ticketId: string }> = [];

  for (const t of tickets) {
    const phone =
      (t.contact?.phone as string | null | undefined) ??
      (t.contact?.mobile as string | null | undefined) ??
      null;
    const fingerprint = phoneFingerprint(phone);
    const outcome = classifyOutcome(t);
    const contactName = t.contact
      ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() || null
      : null;
    const assigneeName = t.assignee
      ? `${t.assignee.firstName ?? ""} ${t.assignee.lastName ?? ""}`.trim() || null
      : null;

    const values = {
      id: t.id,
      ticketNumber: t.ticketNumber != null ? String(t.ticketNumber) : null,
      subject: t.subject ?? null,
      status: t.status ?? null,
      statusType: t.statusType ?? null,
      channel: t.channel ?? null,
      category: t.category ?? null,
      productName: t.productName ?? null,
      resolution: t.resolution ?? null,
      contactId: t.contactId ?? t.contact?.id ?? null,
      contactName,
      contactPhone: phone,
      phoneFingerprint: fingerprint || null,
      assigneeId: t.assigneeId ?? t.assignee?.id ?? null,
      assigneeName,
      customFieldsJson: (t.cf as Record<string, unknown>) ?? null,
      rawJson: t as unknown as Record<string, unknown>,
      outcomeStatus: outcome.status,
      outcomeReason: outcome.reason,
      createdTime: t.createdTime ? new Date(t.createdTime) : null,
      modifiedTime: t.modifiedTime ? new Date(t.modifiedTime) : null,
      closedTime: t.closedTime ? new Date(t.closedTime) : null,
      syncedAt: new Date(),
    };

    await db
      .insert(ticketsTable)
      .values(values)
      .onConflictDoUpdate({ target: ticketsTable.id, set: values });

    // Inalterado desde a última leitura: os comentários também estão, e a
    // chamada não traria nada de novo.
    const novoInstante = t.modifiedTime ? new Date(t.modifiedTime).getTime() : null;
    const jaVisto = conhecidos.get(t.id);
    if (!reler && novoInstante !== null && jaVisto !== undefined && novoInstante <= jaVisto) continue;

    // Threads **e** comentários. Ler só `/comments` deixava de fora todos os
    // emails que a equipa envia aos clientes — ver `normalizarConversa`.
    const comments = await client.listTicketConversations(t.id);
    for (const c of comments) {
      allComments.push({ ...c, ticketId: t.id });
      const cValues = {
        id: c.id,
        ticketId: t.id,
        commentedTime: c.quando ? new Date(c.quando) : null,
        channel: c.canal ?? null,
        direction: c.direcao ?? null,
        authorType: c.autorTipo ?? null,
        authorName: c.autorNome ?? null,
        contentSanitized: sanitizeCommentContent(c.texto),
        rawJson: c as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      };
      await db
        .insert(ticketCommentsTable)
        .values(cValues)
        .onConflictDoUpdate({ target: ticketCommentsTable.id, set: cValues });
    }
  }

  await db.insert(ticketSyncStateTable).values({
    anchor: "default",
    windowFrom: from,
    windowTo: to,
    ticketCount: String(tickets.length),
    commentCount: String(allComments.length),
    syncedAt: new Date(),
  });

  return {
    ticketCount: tickets.length,
    commentCount: allComments.length,
    tickets,
    comments: allComments,
  };
}

// Drizzle's `eq` is imported above to keep the type-checker happy when
// extending this file with selective updates later.
void eq;
