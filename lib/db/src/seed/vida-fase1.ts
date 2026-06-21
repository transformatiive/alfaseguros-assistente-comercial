/**
 * Seed data + idempotent seeder for the Supervisor Virtual V2 — Vida, Fase 1.
 *
 * Source of truth for the roster: the Ringover contacts export (EQUIPA column).
 * Source of truth for the checklist: spec Anexo A, FASE 1.
 * Coaching messages, obligatory categories and compliance points: approved by
 * the Vida coordination (Nuno).
 *
 * Idempotent AND updating: re-running upserts operators (by ringover_user_id)
 * and updates existing categories/items in place (matched by natural key), so
 * editing a message or flag here + re-seeding propagates to prod.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../schema/index";
import {
  colaboradoresTable,
  checklistCategoriesTable,
  checklistItemsTable,
} from "../schema/index";

type DB = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Roster — equipa Vida (11). Emails follow nome.apelido@alfaseguros.pt (no
// accents), confirmed by the coordination.
// ---------------------------------------------------------------------------
export const VIDA_COLABORADORES: Array<{
  nome: string;
  ringoverUserId: string;
  telefone: string;
  email: string;
}> = [
  { nome: "Beatriz Assunção", ringoverUserId: "23515187", telefone: "+351 21 027 0873", email: "beatriz.assuncao@alfaseguros.pt" },
  { nome: "Inês Candeias", ringoverUserId: "23515185", telefone: "+351 21 027 0874", email: "ines.candeias@alfaseguros.pt" },
  { nome: "Lígia Ferreira", ringoverUserId: "23515184", telefone: "+351 21 027 0865", email: "ligia.ferreira@alfaseguros.pt" },
  { nome: "Cláudia Gaião", ringoverUserId: "23515186", telefone: "+351 21 027 0866", email: "claudia.gaiao@alfaseguros.pt" },
  { nome: "Dina Paiva", ringoverUserId: "23515183", telefone: "+351 21 027 0867", email: "dina.paiva@alfaseguros.pt" },
  { nome: "Lara Pereira", ringoverUserId: "23515189", telefone: "+351 21 027 0871", email: "lara.pereira@alfaseguros.pt" },
  { nome: "Rute Rio", ringoverUserId: "23515182", telefone: "+351 21 027 0869", email: "rute.rio@alfaseguros.pt" },
  { nome: "Ana Rodrigues", ringoverUserId: "23515188", telefone: "+351 21 027 0872", email: "ana.rodrigues@alfaseguros.pt" },
  { nome: "Daniela Soares", ringoverUserId: "23515180", telefone: "+351 21 027 0868", email: "daniela.soares@alfaseguros.pt" },
  { nome: "Hélio Vazão", ringoverUserId: "23185416", telefone: "+351 21 027 0876", email: "helio.vazao@alfaseguros.pt" },
  { nome: "Jessica Neto", ringoverUserId: "23515181", telefone: "+351 21 027 0870", email: "jessica.neto@alfaseguros.pt" },
];

// ---------------------------------------------------------------------------
// Checklist — Vida, Fase 1 (1.º Telefonema). 5 categories, 17 points.
// ---------------------------------------------------------------------------
interface SeedItem {
  validacao: string;
  texto: string;
  cond?: boolean;
  quando?: string;
  comp?: boolean;
  mensagem: string;
}
interface SeedCategory {
  nome: string;
  obrigatoria: boolean;
  itens: SeedItem[];
}

export const VIDA_FASE1_CHECKLIST: SeedCategory[] = [
  {
    nome: "Apresentação e Enquadramento do Cliente",
    obrigatoria: true,
    itens: [
      { validacao: "Apresentei-me?", texto: "Disse o meu nome e o da empresa?", comp: true, mensagem: "Comece sempre por dizer o seu nome e que liga da Alfa Seguros. A identificação cria confiança nos primeiros segundos e enquadra a chamada." },
      { validacao: "Gravação", texto: "Solicitei autorização para a gravação da chamada?", comp: true, mensagem: "Peça autorização para gravar a chamada logo no início. É uma exigência legal (RGPD) e protege-o a si e ao cliente." },
      { validacao: "Ajuda", texto: "Informei que estou a ligar para ajudar o cliente a trocar o seguro?", mensagem: "Explique cedo que liga para ajudar o cliente a poupar, trocando o seguro de vida do banco. Clarifica o propósito e baixa as defesas." },
      { validacao: "Enquadramento", texto: "Sei o banco e qual o seguro que o cliente tem?", mensagem: "Antes de simular, confirme o banco e o seguro que o cliente tem. Sem este enquadramento, a proposta perde força e credibilidade." },
    ],
  },
  {
    nome: "Processo de Simulação",
    obrigatoria: true,
    itens: [
      { validacao: "Dados", texto: "Sei as datas de nascimento, o capital em dívida e as profissões?", mensagem: "Recolha sempre as datas de nascimento, o capital em dívida e as profissões. São a base de uma simulação fiável — sem eles, o preço não é credível." },
      { validacao: "Preço", texto: "Informei do preço mensal? E dos preços das outras companhias, sem descontos, mostrando que são mais caros?", mensagem: "Apresente o preço mensal e compare com as outras companhias sem descontos, mostrando que são mais caras. O contraste dá valor à sua proposta." },
      { validacao: "Preço com Desconto", texto: "Informei do preço com desconto e do prazo do desconto?", mensagem: "Ao dar o preço, refira sempre o desconto e o prazo em que se aplica. É o que torna a poupança concreta e imediata para o cliente." },
      { validacao: "Poupança Anual", texto: "Informei da poupança anual em valor ou meses?", mensagem: "Traduza a poupança em números do dia a dia: o valor anual, ou quantos meses de seguro 'oferece'. Poupança tangível convence mais." },
      { validacao: "Gostou? Vamos avançar?", texto: "Perguntei se o cliente gostou da simulação/poupança?", mensagem: "Depois da simulação, pergunte diretamente se o cliente gostou e se podem avançar. Pedir o fecho transforma interesse em proposta." },
      { validacao: "Preenchi a Proposta?", texto: "Se o cliente disse que sim, avancei para o preenchimento, mesmo sem todos os dados?", cond: true, quando: "O cliente aceitou avançar para a proposta.", mensagem: "Quando o cliente diz que sim, avance para o preenchimento na hora, mesmo sem todos os dados. Adiar é o principal motivo de leads que esfriam." },
      { validacao: "Agendamento Contacto", texto: "Se não quis preencher, defini nova data para próximo contacto?", cond: true, quando: "O cliente não quis preencher a proposta nesta chamada.", mensagem: "Se o cliente não avançou agora, combine sempre uma data concreta para o próximo contacto. Um 'volto a ligar' sem data perde-se." },
    ],
  },
  {
    nome: "Argumentação para Proposta",
    obrigatoria: false,
    itens: [
      { validacao: "Poupança Global", texto: "Se disse que não, perguntei os anos em falta do empréstimo e dei o valor global de poupança?", cond: true, quando: "O cliente disse que não avança com a proposta.", mensagem: "Perante um 'não', pergunte os anos que faltam do empréstimo e apresente a poupança global. O valor total costuma reabrir a conversa." },
      { validacao: "Gostou? Vamos avançar?", texto: "Reforcei o valor da poupança global em valor ou em anos?", mensagem: "Reforce a poupança global — em euros ou em anos — antes de pedir o avanço. Recordar o ganho total ajuda a vencer a hesitação." },
    ],
  },
  {
    nome: "Argumentação para Objecções",
    obrigatoria: false,
    itens: [
      { validacao: "Porquê?", texto: "Sei as dúvidas que impedem o cliente de avançar para a proposta?", mensagem: "Procure perceber a dúvida concreta que impede o cliente de avançar. Sem identificar a objeção real, é difícil respondê-la." },
      { validacao: "Esclarecemos o cliente?", texto: "Se sim, preenchi a proposta?", cond: true, quando: "As dúvidas do cliente foram esclarecidas.", mensagem: "Depois de esclarecer as dúvidas, retome o fecho e avance para a proposta. Esclarecimento sem ação não fecha negócio." },
      { validacao: "Quais as dúvidas?", texto: "Se não, tentei perceber as dúvidas?", cond: true, quando: "As dúvidas do cliente não ficaram esclarecidas.", mensagem: "Se as dúvidas persistem, faça perguntas para as trazer ao de cima. Muitas vezes o 'não' esconde uma questão simples por resolver." },
    ],
  },
  {
    nome: "Coberturas",
    obrigatoria: false,
    itens: [
      { validacao: "Falei das coberturas?", texto: "Expliquei de forma informal as diferenças entre IAD, ITP60 e ITP55? Recomendei a melhoria de cobertura?", mensagem: "Explique de forma simples as diferenças entre IAD, ITP60 e ITP55 e recomende a melhoria de cobertura. É um ponto de valor que diferencia a sua proposta." },
    ],
  },
];

const ESCOPO_VIDA = "vida";
const FASE_1 = "primeiro_contacto" as const;

/**
 * Idempotent seed + update. Operators upsert on ringover_user_id; categories
 * and items are inserted if absent and UPDATED in place (matched by natural
 * key) otherwise — so edits to messages/flags here propagate on re-seed.
 */
export async function seedVidaFase1(db: DB): Promise<{ colaboradores: number; categorias: number; itens: number }> {
  for (const c of VIDA_COLABORADORES) {
    await db
      .insert(colaboradoresTable)
      .values({ nome: c.nome, ringoverUserId: c.ringoverUserId, telefone: c.telefone, email: c.email, equipa: "vida" })
      .onConflictDoUpdate({
        target: colaboradoresTable.ringoverUserId,
        set: { nome: c.nome, telefone: c.telefone, email: c.email, equipa: "vida", ativo: true },
      });
  }

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
      await db
        .update(checklistCategoriesTable)
        .set({ obrigatoria: cat.obrigatoria, ordem: ci, ativo: true })
        .where(eq(checklistCategoriesTable.id, categoryId));
    } else {
      const [inserted] = await db
        .insert(checklistCategoriesTable)
        .values({ escopo: ESCOPO_VIDA, fase: FASE_1, nome: cat.nome, obrigatoria: cat.obrigatoria, ordem: ci })
        .returning();
      categoryId = inserted.id;
    }

    for (let ii = 0; ii < cat.itens.length; ii++) {
      const it = cat.itens[ii];
      const fields = {
        validacao: it.validacao,
        condicional: it.cond ?? false,
        condicaoDescricao: it.quando ?? null,
        compliance: it.comp ?? false,
        mensagemMelhoria: it.mensagem,
        ordem: ii,
        ativo: true,
      };
      const existingItem = await db
        .select()
        .from(checklistItemsTable)
        .where(and(eq(checklistItemsTable.categoryId, categoryId), eq(checklistItemsTable.texto, it.texto)));
      if (existingItem.length > 0) {
        await db.update(checklistItemsTable).set(fields).where(eq(checklistItemsTable.id, existingItem[0].id));
      } else {
        await db.insert(checklistItemsTable).values({ categoryId, texto: it.texto, ...fields });
      }
      itens += 1;
    }
  }

  return { colaboradores: VIDA_COLABORADORES.length, categorias: VIDA_FASE1_CHECKLIST.length, itens };
}
