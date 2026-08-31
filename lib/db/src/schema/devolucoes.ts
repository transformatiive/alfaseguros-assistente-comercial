import { pgTable, serial, text, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { colaboradoresTable } from "./colaboradores";

/**
 * Missed inbound calls that still owe the customer a call back ("chamadas por
 * devolver"). One row per Ringover call — `ringoverCallId` is unique so the
 * recompute job can upsert idempotently without duplicating or resurrecting a
 * row an agent has already resolved.
 *
 * `estado` is the whole point of the table:
 *   pendente   — still owed
 *   devolvida  — called back (auto-detected, or marked by the agent)
 *   dispensada — the agent decided no call back is needed
 *
 * `colaboradorId` is nullable on purpose: a missed call on a shared line may
 * not attribute to anyone, and those go to a shared bucket the supervisor
 * sees rather than being silently dropped.
 */
export const devolucoesTable = pgTable(
  "devolucoes",
  {
    id: serial("id").primaryKey(),
    /** Ringover call id of the *missed* call — the idempotency key. */
    ringoverCallId: text("ringover_call_id").notNull().unique(),
    /** Lisbon calendar day of the missed call, as YYYY-MM-DD. */
    data: date("data").notNull(),
    colaboradorId: integer("colaborador_id").references(() => colaboradoresTable.id, {
      onDelete: "set null",
    }),
    /** Customer number exactly as Ringover reported it. */
    numeroCliente: text("numero_cliente").notNull(),
    /** Same number through @workspace/phone — what auto-resolution matches on. */
    numeroNormalizado: text("numero_normalizado").notNull(),
    /** When the missed call came in. */
    horaChamada: timestamp("hora_chamada", { withTimezone: true }).notNull(),
    estado: text("estado", {
      enum: ["pendente", "devolvida", "dispensada"],
    })
      .notNull()
      .default("pendente"),
    resolvidaAt: timestamp("resolvida_at", { withTimezone: true }),
    /** Who resolved it: a colaborador id as text, or "auto". */
    resolvidaPor: text("resolvida_por"),
    /** How it was resolved — `auto` from a later outbound call, `manual` by the agent. */
    origem: text("origem", { enum: ["auto", "manual"] }),
    /** Free text captured by the voice agent, when there is one. */
    contexto: text("contexto"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    dataIdx: index("devolucoes_data_idx").on(t.data),
    colaboradorIdx: index("devolucoes_colaborador_id_idx").on(t.colaboradorId),
    estadoIdx: index("devolucoes_estado_idx").on(t.estado),
    numeroIdx: index("devolucoes_numero_normalizado_idx").on(t.numeroNormalizado),
  }),
);

export const insertDevolucaoSchema = createInsertSchema(devolucoesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDevolucao = z.infer<typeof insertDevolucaoSchema>;
export type Devolucao = typeof devolucoesTable.$inferSelect;
