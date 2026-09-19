import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { colaboradoresTable } from "./colaboradores";

/**
 * Quem abriu o painel, e quando.
 *
 * Existe para responder a uma pergunta que nenhuma outra tabela responde: **o
 * painel está a ser usado?** Todas as outras medem o trabalho da equipa; esta
 * mede o nosso. Um painel que ninguém abre pode ter os números todos certos e
 * na mesma não valer nada.
 *
 * ## Uma linha por pedido, não por sessão
 *
 * A sessão é derivada na leitura, colapsando pedidos próximos uns dos outros
 * (ver `adopcao.ts`). Gravar sessões directamente obrigaria a escolher a regra
 * de colapso *agora*, à escrita, e a viver com ela para sempre — e a primeira
 * regra que se escolhe sobre um comportamento que ainda não se observou é
 * quase de certeza a errada. Instantes crus podem ser reinterpretados; sessões
 * gravadas não.
 *
 * ## Isto não é um registo de auditoria
 *
 * Não guarda IP, browser, nem o que a pessoa viu. Guarda que abriu, qual das
 * abas, e a que horas. Chega para a pergunta e não convida a mais nenhuma:
 * o que não se recolhe não pode ser usado para o que não foi combinado.
 */
export const painelAcessosTable = pgTable(
  "painel_acessos",
  {
    id: serial("id").primaryKey(),
    colaboradorId: integer("colaborador_id")
      .notNull()
      .references(() => colaboradoresTable.id, { onDelete: "cascade" }),
    /** Qual das abas: `meu-dia`, `equipa`, `evolucao`, `adopcao`. */
    vista: text("vista", {
      enum: ["meu-dia", "equipa", "evolucao", "adopcao"],
    }).notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A leitura é sempre "uma janela de tempo, todas as pessoas" — a janela
    // primeiro, por isso, e não o colaborador.
    index("painel_acessos_criado_em_idx").on(t.criadoEm),
    index("painel_acessos_colaborador_idx").on(t.colaboradorId, t.criadoEm),
  ],
);

export const insertPainelAcessoSchema = createInsertSchema(painelAcessosTable).omit({
  id: true,
  criadoEm: true,
});
export type InsertPainelAcesso = z.infer<typeof insertPainelAcessoSchema>;
export type PainelAcesso = typeof painelAcessosTable.$inferSelect;
export type VistaDoPainel = PainelAcesso["vista"];
