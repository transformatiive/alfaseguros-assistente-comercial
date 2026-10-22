import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Análise de Chamadas Vida (TRNSF-2201): gravações da campanha que a
 * Solidnetworks deixa no SFTP. São uma fonte à parte das conversas do Ringover
 * — outro operador, outro guião (4 tipos de chamada) — por isso vivem em
 * tabelas próprias e não em `conversations` / `call_checklist_results`.
 *
 * O transcritor (artifacts/transcritor, na Railway) escreve
 * `transcricoes/<nome>.json` no bucket; o job `chamadas-sftp` regista cada
 * gravação aqui e analisa as que têm transcrição.
 *
 * Criadas no arranque por `setup-chamadas-sftp.ts` (o deploy não corre
 * `drizzle-kit push`); este ficheiro é a forma tipada das mesmas tabelas.
 */

/** Estado do processamento de uma gravação. */
export const ESTADOS_CHAMADA_SFTP = [
  "pendente", // gravação no bucket, ainda sem transcrição
  "curta", // abaixo do tamanho mínimo: o transcritor ignora-a
  "analisada", // conversa real, avaliada contra o guião
  "descartada", // transcrita, mas sem conversa útil (caixa de correio, "ligue mais tarde")
  "erro", // a análise falhou; volta a ser tentada na próxima execução
] as const;

/** Os 4 tipos de chamada do guião da campanha. */
export const TIPOS_CHAMADA_SFTP = ["primeiro", "seguinte", "proposta", "pos_venda"] as const;

export const chamadasSftpTable = pgTable(
  "chamadas_sftp",
  {
    id: serial("id").primaryKey(),
    // Chave completa do mp3 no bucket (ex.: shared/2026_10_21_..._uuid.mp3).
    ficheiro: text("ficheiro").notNull(),
    // Data e hora da chamada (do nome do ficheiro; senão, da data de upload).
    dataHora: timestamp("data_hora", { withTimezone: true }).notNull(),
    // Número do cliente, quando o nome do ficheiro o traz.
    telefone: text("telefone"),
    tamanhoBytes: integer("tamanho_bytes").notNull().default(0),
    duracaoS: real("duracao_s"),
    estado: text("estado", { enum: ESTADOS_CHAMADA_SFTP }).notNull().default("pendente"),
    // Só há um colaborador na campanha (confirmado pela Soraia a 21/10/2026).
    colaborador: text("colaborador").notNull().default("Colaborador Vida"),
    tipo: text("tipo", { enum: TIPOS_CHAMADA_SFTP }),
    resumo: text("resumo"),
    // Como acabou a chamada: proposta | novo_contacto | recusou | outro.
    desfecho: text("desfecho"),
    objecoes: jsonb("objecoes").$type<string[]>(),
    motivoDescarte: text("motivo_descarte"),
    erro: text("erro"),
    modelo: text("modelo"),
    custoUsd: real("custo_usd"),
    analisadaEm: timestamp("analisada_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ficheiroUniq: uniqueIndex("chamadas_sftp_ficheiro_uniq").on(t.ficheiro),
    dataIdx: index("chamadas_sftp_data_idx").on(t.dataHora),
  }),
);

export type ChamadaSftp = typeof chamadasSftpTable.$inferSelect;

/** Resultado de um ponto do guião. "nao_aplicavel" fica fora do total. */
export const ESTADOS_PONTO_SFTP = ["cumprido", "nao_cumprido", "nao_aplicavel"] as const;

export const chamadasSftpResultadosTable = pgTable(
  "chamadas_sftp_resultados",
  {
    id: serial("id").primaryKey(),
    chamadaId: integer("chamada_id")
      .notNull()
      .references(() => chamadasSftpTable.id, { onDelete: "cascade" }),
    // Chave estável do ponto no catálogo (ex.: "primeiro.preco").
    item: text("item").notNull(),
    estado: text("estado", { enum: ESTADOS_PONTO_SFTP }).notNull(),
    // 0..1. Abaixo do limiar o ponto conta como "A rever" e não entra na %.
    confianca: real("confianca").notNull().default(1),
    rever: boolean("rever").notNull().default(false),
    evidencia: text("evidencia"),
  },
  (t) => ({
    chamadaItemUniq: uniqueIndex("chamadas_sftp_resultados_chamada_item_uniq").on(t.chamadaId, t.item),
    itemIdx: index("chamadas_sftp_resultados_item_idx").on(t.item),
  }),
);

export type ChamadaSftpResultado = typeof chamadasSftpResultadosTable.$inferSelect;

/** Destaques escritos pela IA sobre os números de um período. */
export const chamadasSftpDestaquesTable = pgTable("chamadas_sftp_destaques", {
  id: serial("id").primaryKey(),
  periodoDe: text("periodo_de").notNull(), // YYYY-MM-DD
  periodoAte: text("periodo_ate").notNull(),
  conteudo: jsonb("conteudo").notNull(),
  modelo: text("modelo"),
  geradoEm: timestamp("gerado_em", { withTimezone: true }).notNull().defaultNow(),
});

export type ChamadaSftpDestaques = typeof chamadasSftpDestaquesTable.$inferSelect;
