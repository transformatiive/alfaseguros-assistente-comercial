import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  colaboradoresTable,
  devolucoesTable,
  ticketsTable,
  ticketCommentsTable,
  conversationsTable,
} from "@workspace/db";
import { lisbonDayBoundsISO, somarDiasUteis } from "../lib/dates.js";
import { INICIO_DA_SERIE, type Intervalo } from "./evolucao.js";
import { RISCO_THRESHOLD_HOURS } from "./tickets-risco.js";

/**
 * Os intervalos de que a série vive: quando cada tarefa nasceu e quando
 * morreu.
 *
 * Três famílias, e vale a pena ser claro sobre a qualidade de cada uma, porque
 * não é a mesma. Um número que parece exacto e não é vale menos do que um
 * número acompanhado do seu erro.
 *
 *  - **Devoluções** — exacta. A tabela guarda `hora_chamada` e `resolvida_at`;
 *    não há nada a inferir.
 *  - **Tickets** — exacta. `created_time` e `closed_time` vêm do Desk.
 *  - **Follow-ups** — aproximada, e assumidamente. Nasce na conversa que o
 *    gerou; morre na primeira resposta de um **agente** no ticket ligado a
 *    esse cliente. É a mesma regra de prova que o painel usa para fazer a
 *    tarefa desaparecer, por isso as duas concordam — mas um follow-up
 *    resolvido por telefone e sem registo no Desk fica a contar como aberto.
 *    O erro é sempre no mesmo sentido: nunca dá por feito o que não está.
 */

/**
 * Prazo de uma devolução: um dia útil.
 *
 * É o mesmo SLA de primeira resposta que `prazos.ts` aplica, e é deliberado
 * não importar daí: `derivarPrazo` lê promessas escritas em texto para decidir
 * o prazo de uma tarefa concreta, e aqui estamos a medir milhares de linhas
 * onde esse texto não existe. Usar a regra simples e dizê-lo é mais honesto do
 * que fingir precisão que os dados não têm.
 */
function prazoDeDevolucao(horaChamada: Date): string {
  const dia = horaChamada.toISOString().slice(0, 10);
  return lisbonDayBoundsISO(somarDiasUteis(dia, 1))[1];
}

/** Prazo de um ticket: as mesmas 24 h a partir da abertura que o painel usa. */
function prazoDeTicket(criadoEm: Date): string {
  return new Date(criadoEm.getTime() + RISCO_THRESHOLD_HOURS * 3_600_000).toISOString();
}

export interface CarregarIntervalosParams {
  /** Primeiro dia da janela. Nunca anterior a `INICIO_DA_SERIE`. */
  de: string;
  /** Último dia da janela, normalmente hoje. */
  ate: string;
}

export async function carregarIntervalos(
  params: CarregarIntervalosParams,
): Promise<Intervalo[]> {
  const de = params.de < INICIO_DA_SERIE ? INICIO_DA_SERIE : params.de;
  // Tarefas nascidas antes da janela contam na mesma: se estavam abertas no
  // primeiro dia, o volume tem de as incluir ou o gráfico abre com uma queda
  // que nunca aconteceu. Por isso o corte é no *fecho*, não no nascimento —
  // só se descartam as que já estavam fechadas antes de a janela começar.
  const inicioDaJanela = new Date(lisbonDayBoundsISO(de)[0]);
  const fimDaJanela = new Date(lisbonDayBoundsISO(params.ate)[1]);

  const aindaViva = (fechadoEm: Date | null): boolean =>
    fechadoEm === null || fechadoEm >= inicioDaJanela;

  const [devolucoes, tickets, followUps] = await Promise.all([
    db
      .select({
        colaboradorId: devolucoesTable.colaboradorId,
        horaChamada: devolucoesTable.horaChamada,
        resolvidaAt: devolucoesTable.resolvidaAt,
        estado: devolucoesTable.estado,
      })
      .from(devolucoesTable)
      .where(lte(devolucoesTable.horaChamada, fimDaJanela)),

    db
      .select({
        assigneeId: ticketsTable.assigneeId,
        createdTime: ticketsTable.createdTime,
        closedTime: ticketsTable.closedTime,
        statusType: ticketsTable.statusType,
      })
      .from(ticketsTable)
      .where(and(isNotNull(ticketsTable.createdTime), lte(ticketsTable.createdTime, fimDaJanela))),

    carregarFollowUps(de, fimDaJanela),
  ]);

  // zid → colaborador, para atribuir os tickets a uma pessoa e não a um id do
  // Zoho que ninguém reconhece num gráfico.
  const porZid = new Map<string, number>();
  for (const c of await db
    .select({ id: colaboradoresTable.id, zid: colaboradoresTable.zid })
    .from(colaboradoresTable)
    .where(isNotNull(colaboradoresTable.zid))) {
    if (c.zid) porZid.set(c.zid, c.id);
  }

  const out: Intervalo[] = [];

  for (const d of devolucoes) {
    // `dispensada` é uma decisão, não um trabalho feito, mas fecha a tarefa
    // tal como `devolvida`: a partir daí deixa de estar em cima da mesa de
    // alguém, que é o que estas curvas medem.
    const fim = d.estado === "pendente" ? null : (d.resolvidaAt ?? null);
    if (!aindaViva(fim)) continue;
    out.push({
      familia: "devolucao",
      colaboradorId: d.colaboradorId,
      inicio: d.horaChamada.toISOString(),
      fim: fim ? fim.toISOString() : null,
      prazo: prazoDeDevolucao(d.horaChamada),
    });
  }

  for (const t of tickets) {
    if (!t.createdTime) continue;
    const fechado = t.statusType === "Closed";
    // Um ticket fechado sem `closed_time` existe — o Desk não o preenche em
    // todos os canais. É descartado em vez de adivinhado: contá-lo como aberto
    // inflacionaria o volume para sempre, e datar-lhe o fecho pela última
    // modificação poria ruído na curva que interessa mais, a das horas até
    // fechar. Descartar tira-o das duas.
    const fim = fechado ? (t.closedTime ?? null) : null;
    if (fechado && fim === null) continue;
    if (!aindaViva(fim)) continue;
    out.push({
      familia: "ticket",
      colaboradorId: t.assigneeId ? (porZid.get(t.assigneeId) ?? null) : null,
      inicio: t.createdTime.toISOString(),
      fim: fim ? fim.toISOString() : null,
      prazo: prazoDeTicket(t.createdTime),
    });
  }

  for (const f of followUps) {
    if (!aindaViva(f.fim)) continue;
    out.push({
      familia: "follow_up",
      colaboradorId: f.colaboradorId,
      inicio: f.inicio.toISOString(),
      fim: f.fim ? f.fim.toISOString() : null,
      prazo: prazoDeTicket(f.inicio),
    });
  }

  return out;
}

interface FollowUpBruto {
  colaboradorId: number | null;
  inicio: Date;
  fim: Date | null;
}

/**
 * Follow-ups, com a mesma prova que faz a tarefa desaparecer do painel.
 *
 * Nasce no fim da conversa em que a IA marcou `followUpNecessario`. Morre na
 * primeira resposta de um **agente** (`authorType = 'AGENT'`) num ticket do
 * mesmo cliente, depois desse instante. Um comentário do cliente ou do sistema
 * não conta — um "Reminder for your task" gerado pelo Desk é um comentário,
 * não é uma resposta.
 *
 * A ligação entre a conversa e o ticket é a impressão digital do número: os
 * últimos nove dígitos, que é a única forma em que o Ringover e o Desk
 * concordam.
 */
async function carregarFollowUps(de: string, ate: Date): Promise<FollowUpBruto[]> {
  const conversas = await db
    .select({
      customerPhone: conversationsTable.customerPhone,
      runDate: conversationsTable.runDate,
      colaboradorId: conversationsTable.colaboradorId,
      agentId: conversationsTable.agentId,
      legsJson: conversationsTable.legsJson,
    })
    .from(conversationsTable)
    .where(
      and(
        sql`${conversationsTable.analysisJson}->>'followUpNecessario' = 'true'`,
        gte(conversationsTable.runDate, somarDiasAtras(de, 42)),
      ),
    );

  if (conversas.length === 0) return [];

  const porRingover = new Map<string, number>();
  for (const c of await db
    .select({ id: colaboradoresTable.id, ringoverUserId: colaboradoresTable.ringoverUserId })
    .from(colaboradoresTable)
    .where(isNotNull(colaboradoresTable.ringoverUserId))) {
    if (c.ringoverUserId) porRingover.set(c.ringoverUserId, c.id);
  }

  // Respostas de agente, por impressão digital do cliente, ordenadas no tempo.
  const respostas = await db
    .select({
      quando: ticketCommentsTable.commentedTime,
      fingerprint: ticketsTable.phoneFingerprint,
    })
    .from(ticketCommentsTable)
    .innerJoin(ticketsTable, eq(ticketCommentsTable.ticketId, ticketsTable.id))
    .where(
      and(
        eq(ticketCommentsTable.authorType, "AGENT"),
        isNotNull(ticketCommentsTable.commentedTime),
        isNotNull(ticketsTable.phoneFingerprint),
      ),
    );

  const porImpressao = new Map<string, number[]>();
  for (const r of respostas) {
    if (!r.quando || !r.fingerprint) continue;
    const lista = porImpressao.get(r.fingerprint) ?? [];
    lista.push(r.quando.getTime());
    porImpressao.set(r.fingerprint, lista);
  }
  for (const lista of porImpressao.values()) lista.sort((a, b) => a - b);

  const out: FollowUpBruto[] = [];
  for (const c of conversas) {
    const digitos = (c.customerPhone ?? "").replace(/\D/g, "");
    const fp = digitos.length >= 9 ? digitos.slice(-9) : null;
    const inicio = nascimentoDoFollowUp(c.legsJson, c.runDate);
    if (inicio > ate) continue;

    let fim: Date | null = null;
    if (fp) {
      const t = inicio.getTime();
      const primeira = (porImpressao.get(fp) ?? []).find((q) => q > t);
      if (primeira !== undefined) fim = new Date(primeira);
    }
    out.push({
      // `colaboradorId` já vem resolvido nas conversas recentes; o mapa pelo
      // id do Ringover cobre as mais antigas, anteriores a essa coluna.
      colaboradorId:
        c.colaboradorId ?? (c.agentId ? (porRingover.get(c.agentId) ?? null) : null),
      inicio,
      fim,
    });
  }
  return out;
}

/**
 * Quando é que o follow-up nasceu: no fim da última chamada da conversa.
 *
 * A coluna `conversations` não guarda hora nenhuma, só o dia — mas guarda as
 * pernas da conversa em `legs_json`, e cada perna tem `startTime` e
 * `durationSec`. A última perna a acabar é o momento em que a conversa
 * terminou, e é aí que a promessa passa a ser devida.
 *
 * A primeira versão disto usava o **fim do dia** da conversa, para não
 * inflacionar a mediana de horas até fechar. Foi um erro caro e silencioso:
 * uma resposta enviada no próprio dia, às quatro da tarde, é anterior às
 * 23:59 e ficava de fora. O resultado em produção foram 710 follow-ups e
 * *zero* fechos — cem por cento em atraso, o que não é um número mau, é um
 * número impossível.
 *
 * Sem pernas com hora, o fim do dia continua a ser o recuo. É o mesmo erro,
 * mas confinado às conversas a que falta o dado em vez de a todas.
 */
function nascimentoDoFollowUp(legsJson: unknown, runDate: string): Date {
  let ultima: number | null = null;
  if (Array.isArray(legsJson)) {
    for (const perna of legsJson) {
      if (!perna || typeof perna !== "object") continue;
      const p = perna as { startTime?: unknown; durationSec?: unknown };
      if (typeof p.startTime !== "string") continue;
      const inicio = Date.parse(p.startTime);
      if (Number.isNaN(inicio)) continue;
      const fim = inicio + (typeof p.durationSec === "number" ? p.durationSec : 0) * 1000;
      if (ultima === null || fim > ultima) ultima = fim;
    }
  }
  return ultima !== null ? new Date(ultima) : new Date(lisbonDayBoundsISO(runDate)[1]);
}

/** `YYYY-MM-DD`, n dias antes. */
function somarDiasAtras(data: string, dias: number): string {
  const [y, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - dias * 86_400_000).toISOString().slice(0, 10);
}
