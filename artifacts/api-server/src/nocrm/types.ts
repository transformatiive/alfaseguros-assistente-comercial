import { z } from "zod";

/**
 * Formas das respostas da API v2 do noCRM, só com os campos que usamos.
 * Tudo o que vem de fora passa por aqui antes de ser usado.
 * Referência: https://www.nocrm.io/api
 */

const userRefSchema = z.object({ id: z.number() }).passthrough().nullable().optional();

export const nocrmUserSchema = z.object({
  id: z.number(),
  firstname: z.string().nullable().optional(),
  lastname: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  is_disabled: z.boolean().nullable().optional(),
});
export type NocrmApiUser = z.infer<typeof nocrmUserSchema>;

export const nocrmLeadSchema = z.object({
  id: z.number(),
  title: z.string().nullable().optional(),
  step: z.string().nullable().optional(),
  step_id: z.number().nullable().optional(),
  status: z.string(),
  amount: z.number().nullable().optional(),
  user_id: z.number().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  client_folder_name: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  next_action_at: z.string().nullable().optional(),
  remind_date: z.string().nullable().optional(),
  remind_time: z.string().nullable().optional(),
});
export type NocrmApiLead = z.infer<typeof nocrmLeadSchema>;

export const nocrmCommentSchema = z.object({
  id: z.number(),
  content: z.string().nullable().optional(),
  raw_content: z.string().nullable().optional(),
  created_at: z.string(),
  activity_id: z.number().nullable().optional(),
  user: userRefSchema,
});
export type NocrmApiComment = z.infer<typeof nocrmCommentSchema>;

export const nocrmHistorySchema = z.object({
  id: z.number(),
  action_type: z.string(),
  action_item: z
    .object({ name: z.string().nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
  created_at: z.string(),
  user: userRefSchema,
});
export type NocrmApiHistory = z.infer<typeof nocrmHistorySchema>;

export const nocrmTagSchema = z.object({
  name: z.string(),
  category: z.string().nullable().optional(),
});
export type NocrmApiTag = z.infer<typeof nocrmTagSchema>;
