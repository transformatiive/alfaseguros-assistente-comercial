/**
 * Seed data + idempotent seeder for the Supervisor Virtual V2 — Vida, Fase 1.
 *
 * Source of truth for the roster: the Ringover contacts export (EQUIPA column).
 * Source of truth for the checklist: spec Anexo A, FASE 1.
 *
 * NOTES / pending business decisions (do NOT treat as final — see spec §8):
 *  - `obrigatoria` is left FALSE on every category until the Vida coordination
 *    confirms which ones trigger alerts. Alerts are not wired yet anyway.
 *  - `compliance` is set TRUE only on the two candidates (apresentação, gravação)
 *    flagged in the catalogue — to confirm.
 *  - `mensagemMelhoria` is left empty until the coaching texts are written.
 *  - Operator emails are left null until provided — the alert digest needs them.
 *
 * This module is data + a function. It does NOT run on import. Apply it
 * explicitly against a database (and only after the schema is pushed).
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../schema/index.js";
import {
  colaboradoresTable,
  checklistCategoriesTable,
  checklistItemsTable,
} from "../schema/index.js";

type DB = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Roster — equipa Vida (11). Ringover user_id is the join key with calls.
// ---------------------------------------------------------------------------
export const VIDA_COLABORADORES: Array<{
  nome: string;
  ringoverUserId: string;
  telefone: string;
}> = [
  { nome: "Beatriz Assunção", ringoverUserId: "23515187", telefone: "+351 21 027 0873" },
  { nome: "Inês Candeias", ringoverUserId: "23515185", telefone: "+351 21 027 0874" },
  { nome: "Lígia Ferreira", ringoverUserId: "23515184", telefone: "+351 21 027 0865" },
  { nome: "Cláudia Gaião", ringoverUserId: "23515186", telefone: "+351 21 027 0866" },
  { nome: "Dina Paiva", ringoverUserId: "23515183", telefone: "+351 21 027 0867" },
  { nome: "Lara Pereira", ringoverUserId: "23515189", telefone: "+351 21 027 0871" },
  { nome: "Rute Rio", ringoverUserId: "23515182", telefone: "+351 21 027 0869" },
  { nome: "Ana Rodrigues", ringoverUserId: "23515188", telefone: "+351 21 027 0872" },
  { nome: "Daniela Soares", ringoverUserId: "23515180", telefone: "+351 21 027 0868" },
  { nome: "Hélio Vazão", ringoverUserId: "23185416", telefone: "+351 21 027 0876" },
  { nome: "Jessica Neto", ringoverUserId: "23515181", telefone: "+351 21 027 0870" },
];

// ---------------------------------------------------------------------------
// Checklist — Vida, Fase 1 (1.º Telefonema). 5 categories, 17 points.
// `cond` → conditional; `comp` → compliance candidate; `quando` → the condition.
// ---------------------------------------------------------------------------
interface SeedItem {
  validacao: string;
  texto: string;
  cond?: boolean;
  quando?: string;
  comp?: boolean;
}
interface SeedCategory {
  nome: string;
  itens: SeedItem[];
}

export const VIDA_FASE1_CHECKLIST: SeedCategory[] = [
  {
    nome: "Apresentação e Enquadramento do Cliente",
    itens: [
      { validacao: "Apresentei-me?", texto: "Disse o meu nome e o da empresa?", comp: true },
      { validacao: "Gravação", texto: "Solicitei autorização para a gravação da chamada?", comp: true },
      { validacao: "Ajuda", texto: "Informei que estou a ligar para ajudar o cliente a trocar o seguro?" },
      { validacao: "Enquadramento", texto: "Sei o banco e qual o seguro que o cliente tem?" },
    ],
  },
  {
    nome: "Processo de Simulação",
    itens: [
      { validacao: "Dados", texto: "Sei as datas de nascimento, o capital em dívida e as profissões?" },
      { validacao: "Preço", texto: "Informei do preço mensal? E dos preços das outras companhias, sem descontos, mostrando que são mais caros?" },
      { validacao: "Preço com Desconto", texto: "Informei do preço com desconto e do prazo do desconto?" },
      { validacao: "Poupança Anual", texto: "Informei da poupança anual em valor ou meses?" },
      { validacao: "Gostou? Vamos avançar?", texto: "Perguntei se o cliente gostou da simulação/poupança?" },
      { validacao: "Preenchi a Proposta?", texto: "Se o cliente disse que sim, avancei para o preenchimento, mesmo sem todos os dados?", cond: true, quando: "O cliente aceitou avançar para a proposta." },
      { validacao: "Agendamento Contacto", texto: "Se não quis preencher, defini nova data para próximo contacto?", cond: true, quando: "O cliente não quis preencher a proposta nesta chamada." },
    ],
  },
  {
    nome: "Argumentação para Proposta",
    itens: [
      { validacao: "Poupança Global", texto: "Se disse que não, perguntei os anos em falta do empréstimo e dei o valor global de poupança?", cond: true, quando: "O cliente disse que não avança com a proposta." },
      { validacao: "Gostou? Vamos avançar?", texto: "Reforcei o valor da poupança global em valor ou em anos?" },
    ],
  },
  {
    nome: "Argumentação para Objecções",
    itens: [
      { validacao: "Porquê?", texto: "Sei as dúvidas que impedem o cliente de avançar para a proposta?" },
      { validacao: "Esclarecemos o cliente?", texto: "Se sim, preenchi a proposta?", cond: true, quando: "As dúvidas do cliente foram esclarecidas." },
      { validacao: "Quais as dúvidas?", texto: "Se não, tentei perceber as dúvidas?", cond: true, quando: "As dúvidas do cliente não ficaram esclarecidas." },
    ],
  },
  {
    nome: "Coberturas",
    itens: [
      { validacao: "Falei das coberturas?", texto: "Expliquei de forma informal as diferenças entre IAD, ITP60 e ITP55? Recomendei a melhoria de cobertura?" },
    ],
  },
];

const ESCOPO_VIDA = "vida";
const FASE_1 = "primeiro_contacto" as const;

/**
 * Idempotent seed. Safe to run repeatedly: operators upsert on the unique
 * `ringover_user_id`; categories/items are inserted only if absent (matched by
 * natural key). Returns a small summary for logging.
 */
export async function seedVidaFase1(db: DB): Promise<{ colaboradores: number; categorias: number; itens: number }> {
  // 1. Operators
  for (const c of VIDA_COLABORADORES) {
    await db
      .insert(colaboradoresTable)
      .values({ nome: c.nome, ringoverUserId: c.ringoverUserId, telefone: c.telefone, equipa: "vida" })
      .onConflictDoUpdate({
        target: colaboradoresTable.ringoverUserId,
        set: { nome: c.nome, telefone: c.telefone, equipa: "vida", ativo: true },
      });
  }

  // 2. Categories + items
  let categorias = 0;
  let itens = 0;
  for (let ci = 0; ci < VIDA_FASE1_CHECKLIST.length; ci++) {
    const cat = VIDA_FASE1_CHECKLIST[ci];

    const existingCat = await db
      .select()
      .from(checklistCategoriesTable)
      .where(
        and(
          eq(checklistCategoriesTable.escopo, ESCOPO_VIDA),
          eq(checklistCategoriesTable.fase, FASE_1),
          eq(checklistCategoriesTable.nome, cat.nome),
        ),
      );

    let categoryId: number;
    if (existingCat.length > 0) {
      categoryId = existingCat[0].id;
    } else {
      const [inserted] = await db
        .insert(checklistCategoriesTable)
        .values({ escopo: ESCOPO_VIDA, fase: FASE_1, nome: cat.nome, obrigatoria: false, ordem: ci })
        .returning();
      categoryId = inserted.id;
      categorias += 1;
    }

    for (let ii = 0; ii < cat.itens.length; ii++) {
      const it = cat.itens[ii];
      const existingItem = await db
        .select()
        .from(checklistItemsTable)
        .where(and(eq(checklistItemsTable.categoryId, categoryId), eq(checklistItemsTable.texto, it.texto)));
      if (existingItem.length > 0) continue;
      await db.insert(checklistItemsTable).values({
        categoryId,
        validacao: it.validacao,
        texto: it.texto,
        condicional: it.cond ?? false,
        condicaoDescricao: it.quando ?? null,
        compliance: it.comp ?? false,
        mensagemMelhoria: "",
        ordem: ii,
      });
      itens += 1;
    }
  }

  return { colaboradores: VIDA_COLABORADORES.length, categorias, itens };
}
