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
    id: z.string().optional(),
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
