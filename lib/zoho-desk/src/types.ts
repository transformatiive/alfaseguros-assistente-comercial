import { z } from "zod";

export const zohoContactSchema = z
  .object({
    id: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    mobile: z.string().nullable().optional(),
  })
  .passthrough();

export type ZohoContact = z.infer<typeof zohoContactSchema>;

export const zohoAssigneeSchema = z
  .object({
    id: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .passthrough();

export type ZohoAssignee = z.infer<typeof zohoAssigneeSchema>;

/**
 * Ticket schema, passthrough on `cf` (custom fields) — that's where
 * Alfaseguros' outcome data lives. We keep `.passthrough()` so unknown
 * cf_* fields survive intact and the probe CLI can surface them.
 */
export const zohoTicketSchema = z
  .object({
    id: z.string(),
    ticketNumber: z.union([z.string(), z.number()]).optional(),
    subject: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    statusType: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
    resolution: z.string().nullable().optional(),
    contactId: z.string().nullable().optional(),
    contact: zohoContactSchema.nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    assignee: zohoAssigneeSchema.nullable().optional(),
    createdTime: z.string().nullable().optional(),
    modifiedTime: z.string().nullable().optional(),
    closedTime: z.string().nullable().optional(),
    cf: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ZohoTicket = z.infer<typeof zohoTicketSchema>;

export const ticketsListResponseSchema = z.object({
  data: z.array(zohoTicketSchema).optional(),
  count: z.number().optional(),
});

export type TicketsListResponse = z.infer<typeof ticketsListResponseSchema>;

export const zohoCommentAuthorSchema = z
  .object({
    // O Desk manda `id: null` nos autores de threads que não são pessoas da
    // organização (encaminhamentos, remetentes desconhecidos). Não o usamos, e
    // exigir texto aqui derrubava a sincronização inteira por causa de um só
    // thread: foi o que aconteceu na primeira releitura, a 23/09.
    id: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })
  .passthrough();

export const zohoCommentSchema = z
  .object({
    id: z.string(),
    commentedTime: z.string().nullable().optional(),
    modifiedTime: z.string().nullable().optional(),
    isPublic: z.boolean().optional(),
    channel: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    contentType: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),
    commenter: zohoCommentAuthorSchema.nullable().optional(),
    authorType: z.string().nullable().optional(),
  })
  .passthrough();

export type ZohoComment = z.infer<typeof zohoCommentSchema>;

export const commentsListResponseSchema = z.object({
  data: z.array(zohoCommentSchema).optional(),
});

export type CommentsListResponse = z.infer<typeof commentsListResponseSchema>;

/**
 * A Zoho Desk agent. Only the fields the identity backfill needs — Desk
 * returns considerably more, and `passthrough` is deliberate so a schema
 * change on their side does not break the parse.
 */
export const zohoAgentSchema = z
  .object({
    id: z.string(),
    emailId: z.string().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    status: z.string().nullish(),
  })
  .passthrough();

export const agentsListResponseSchema = z.object({
  data: z.array(zohoAgentSchema).optional(),
});

export type ZohoAgent = z.infer<typeof zohoAgentSchema>;
export type AgentsListResponse = z.infer<typeof agentsListResponseSchema>;

// ---------------------------------------------------------------------------
// Conversas: threads **e** comentários
// ---------------------------------------------------------------------------

/**
 * O Desk guarda duas coisas diferentes dentro de um ticket, e durante meses
 * lemos só uma.
 *
 * **Comentários** são notas internas — o que a equipa escreve para si própria.
 * **Threads** são os emails trocados com o cliente. O email que um agente
 * envia a responder a um pedido é um thread, nunca um comentário.
 *
 * Lemos `/comments`, por isso **todas as respostas enviadas aos clientes eram
 * invisíveis para nós**. O painel dizia "sem resposta tua no ticket" a quem
 * tinha respondido nesse dia, e a métrica de primeira resposta media quase
 * nada. Foi o Tiago Paiva que deu por isso, com três casos em que tinha
 * respondido e o painel insistia que não.
 *
 * O `/conversations` devolve as duas coisas numa chamada, ao mesmo custo de
 * quota do `/comments` (3 créditos) e com o scope que já temos
 * (`Desk.tickets.READ`). Por isso isto não é uma chamada a mais: é a mesma
 * chamada, no sítio certo.
 *
 * As duas formas distinguem-se pelo campo `type`, e quase não partilham
 * nomes — o comentário tem `commenter`/`commentedTime`/`content`, o thread
 * tem `author`/`createdTime`/`summary`. Daí a normalização.
 */
export const zohoConversaSchema = z
  .object({
    id: z.string(),
    type: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),

    // Forma de comentário
    commentedTime: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    commenter: zohoCommentAuthorSchema.nullable().optional(),
    isPublic: z.boolean().nullable().optional(),

    // Forma de thread
    createdTime: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    author: zohoCommentAuthorSchema.extend({ name: z.string().nullable().optional() })
      .nullable()
      .optional(),
    isDescriptionThread: z.boolean().nullable().optional(),
    visibility: z.string().nullable().optional(),
  })
  .passthrough();

export type ZohoConversa = z.infer<typeof zohoConversaSchema>;

export const conversasListResponseSchema = z.object({
  data: z.array(zohoConversaSchema).optional(),
});

/** Uma entrada da conversa, já reduzida ao que guardamos. */
export interface ConversaNormalizada {
  id: string;
  /** `thread` (email com o cliente) ou `comment` (nota interna). */
  tipo: "thread" | "comment";
  /** Instante ISO, ou `null` quando o Desk não o deu. */
  quando: string | null;
  canal: string | null;
  /** `in` / `out` num thread; quase sempre ausente num comentário. */
  direcao: string | null;
  /** `AGENT` | `END_USER` | `SYSTEM`. */
  autorTipo: string | null;
  autorNome: string | null;
  /**
   * O texto.
   *
   * Num comentário é o conteúdo inteiro. **Num thread é o `summary`, que é um
   * resumo e não o email completo** — o corpo exige uma chamada por thread
   * (`/threads/{id}?include=plainText`), e isso multiplicaria a quota por
   * dezenas. Chega para o que o painel precisa hoje: saber que houve resposta
   * e quando. Não chega para classificar o *conteúdo* da resposta, que é
   * trabalho de IA e uma decisão à parte.
   */
  texto: string | null;
}

function nomeDe(a: { firstName?: string | null; lastName?: string | null; name?: string | null } | null | undefined): string | null {
  if (!a) return null;
  if (a.name && a.name.trim()) return a.name.trim();
  const composto = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
  return composto || null;
}

/**
 * Reduz qualquer das duas formas à mesma linha.
 *
 * O `type` decide, e não a presença dos campos: uma forma que ganhe um campo
 * novo amanhã continua a ser lida pelo que ela diz ser. Quando falta — e a
 * documentação não promete que venha sempre — a presença de `commenter`
 * desempata, porque é o campo que só o comentário tem.
 */
export function normalizarConversa(c: ZohoConversa): ConversaNormalizada {
  const tipo: "thread" | "comment" =
    c.type === "comment" ? "comment" : c.type === "thread" ? "thread" : c.commenter ? "comment" : "thread";

  const autor = tipo === "comment" ? c.commenter : c.author;
  return {
    id: c.id,
    tipo,
    quando: (tipo === "comment" ? c.commentedTime : c.createdTime) ?? c.commentedTime ?? c.createdTime ?? null,
    canal: c.channel ?? null,
    direcao: c.direction ?? null,
    autorTipo: autor?.type ?? null,
    autorNome: nomeDe(autor),
    texto: (tipo === "comment" ? c.content : c.summary) ?? null,
  };
}
