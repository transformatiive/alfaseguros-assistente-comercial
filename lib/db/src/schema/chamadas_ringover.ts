import { pgTable, text, integer, boolean, date, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Every Ringover call, answered or not, with or without a `note`. The daily
 * analysis keeps only calls worth sending to the LLM; this table keeps them
 * all, because the macro view ("Análise de Chamadas · Visão geral") counts
 * what the analysis throws away: missed calls, short calls, outbound attempts.
 *
 * The team is NOT stored here. It is resolved at read time from
 * `colaboradores`, so a roster change applies to past days too.
 */
export const chamadasRingoverTable = pgTable(
  "chamadas_ringover",
  {
    /** Ringover `cdr_id` — the idempotency key. */
    cdrId: text("cdr_id").primaryKey(),
    inicio: timestamp("inicio", { withTimezone: true }).notNull(),
    /** Lisbon calendar day of `inicio`. */
    dia: date("dia").notNull(),
    /** Lisbon wall-clock hour of `inicio` (0–23). */
    hora: integer("hora").notNull(),
    direcao: text("direcao", { enum: ["in", "out"] }).notNull(),
    atendida: boolean("atendida").notNull(),
    /** Ringover `last_state` when present (ANSWERED, MISSED, VOICEMAIL, …). */
    estado: text("estado"),
    /** Talk time in seconds (answered calls only). */
    duracaoS: integer("duracao_s"),
    /** Seconds the customer waited before a person picked up (answered inbound only). */
    esperaS: integer("espera_s"),
    /** Ringover user_id as digits — matches colaboradores.ringover_user_id. */
    agenteId: text("agente_id"),
    agenteNome: text("agente_nome"),
    /** The customer end of the call, digits only. */
    clienteNumero: text("cliente_numero"),
    sincronizadaEm: timestamp("sincronizada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chamadas_ringover_dia_idx").on(t.dia)],
);

/** One row per Lisbon day already pulled from Ringover. */
export const chamadasRingoverDiasTable = pgTable("chamadas_ringover_dias", {
  dia: date("dia").primaryKey(),
  total: integer("total").notNull(),
  sincronizadoEm: timestamp("sincronizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export type ChamadaRingover = typeof chamadasRingoverTable.$inferSelect;
export type InsertChamadaRingover = typeof chamadasRingoverTable.$inferInsert;
