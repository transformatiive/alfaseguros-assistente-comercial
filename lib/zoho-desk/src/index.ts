export { ZohoAuth, type ZohoAuthOptions } from "./auth.js";
export {
  DEFAULT_TICKET_FIELDS,
  ZohoDeskClient,
  ZohoDeskError,
  type ListTicketsParams,
  type ZohoDeskClientOptions,
} from "./client.js";
export {
  agentsListResponseSchema,
  zohoAgentSchema,
  zohoTicketSchema,
  zohoCommentSchema,
  zohoContactSchema,
  ticketsListResponseSchema,
  commentsListResponseSchema,
  type CommentsListResponse,
  type TicketsListResponse,
  type AgentsListResponse,
  type ZohoAgent,
  type ZohoAssignee,
  type ZohoComment,
  type ZohoContact,
  type ZohoTicket,
} from "./types.js";
