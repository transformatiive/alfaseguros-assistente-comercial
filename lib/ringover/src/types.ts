import { z } from "zod";

export const ringoverUserSchema = z.object({
  user_id: z.number(),
  firstname: z.string().nullable().optional(),
  lastname: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  team_id: z.number().nullable().optional(),
}).passthrough();

export type RingoverUser = z.infer<typeof ringoverUserSchema>;

export const ringoverCallSchema = z.object({
  cdr_id: z.union([z.number(), z.string()]),
  call_id: z.union([z.number(), z.string()]).optional(),
  channel_id: z.union([z.number(), z.string()]).optional(),
  type: z.string().optional(),
  direction: z.string().optional(),
  is_answered: z.boolean().optional(),
  duration: z.number().nullish(),
  total_duration: z.number().nullish(),
  incall_duration: z.number().nullish(),
  start_time: z.string().nullish(),
  answered_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  from_number: z.string().nullable().optional(),
  to_number: z.string().nullable().optional(),
  contact_number: z.string().nullable().optional(),
  user: ringoverUserSchema.nullable().optional(),
  user_id: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
  record: z.string().nullable().optional(),
  recording_url: z.string().nullable().optional(),
  tags: z.array(z.unknown()).nullish(),
}).passthrough();

export type RingoverCall = z.infer<typeof ringoverCallSchema>;

export const listCallsResponseSchema = z.object({
  call_list: z.array(ringoverCallSchema),
  total_call_count: z.number().optional(),
}).passthrough();

export type ListCallsResponse = z.infer<typeof listCallsResponseSchema>;
