import { Router, type IRouter } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { diaDaSemana, lisbonInstant, somarDias, todayLisbon, toLisbonDate } from "../lib/dates.js";
import { runSyncNocrm } from "../jobs/sync-nocrm.js";
import * as repo from "../storage/nocrm-repo.js";
import {
  ALERTA_NOME,
  agendaComEstado,
  aberta,
  atrasada,
  calcularAlertas,
  calcularResumo,
  diasNoPasso,
  eConversa,
  eTentativa,
  parada,
  PRAZO_PASSO_DIAS,
} from "../vida/regras.js";

/**
 * Painel do pipeline da equipa Vida, sobre o espelho do noCRM.
 *
 *  - `POST /api/vida/pipeline/sync`: o n8n chama; protegido por `X-Cron-Secret`.
 *    Vai em `vidaPipelineSyncRouter`, montado antes do `requireAuth`.
 *  - `GET /api/vida/pipeline/{resumo,colaborador/:userId,alertas}`: o ecrã
 *    chama; atrás da sessão (router por omissão, montado depois do `requireAuth`).
 *
 * Os GET nunca chamam o noCRM: leem só da base de dados.
 */

export const vidaPipelineSyncRouter: IRouter = Router();
const router: IRouter = Router();

vidaPipelineSyncRouter.post("/vida/pipeline/sync", (req, res, next) => {
  void (async () => {
    const cfg = env();
    if (!cfg.CRON_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Cron secret not configured on server" });
      return;
    }
    if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
      res.status(401).json({ error: "Invalid X-Cron-Secret" });
      return;
    }
    // 200 mesmo quando falha: o corpo diz o que aconteceu, e um 500 faria o
    // n8n repetir e gastar mais pedidos ao noCRM.
    res.json(await runSyncNocrm());
  })().catch(next);
});

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodoSchema = z.object({ de: DIA.optional(), ate: DIA.optional() });

/** Segunda-feira da semana de `dia`. */
function segunda(dia: string): string {
  const w = diaDaSemana(dia);
  return somarDias(dia, w === 0 ? -6 : 1 - w);
}

/** Dia útil anterior a `dia`. */
function diaUtilAnterior(dia: string): string {
  let d = somarDias(dia, -1);
  while (diaDaSemana(d) === 0 || diaDaSemana(d) === 6) d = somarDias(d, -1);
  return d;
}

async function estadoSync(): Promise<{ ultimaCorridaEm: string | null; pedidosNoDia: number; dia: string | null; ultimoResultado: unknown }> {
  const e = await repo.lerEstadoSync();
  return { ultimaCorridaEm: e.ultimaCorridaEm?.toISOString() ?? null, pedidosNoDia: e.pedidosNoDia, dia: e.dia, ultimoResultado: e.ultimoResultado };
}

/** Eventos desde 60 dias antes do início: chegam para as sequências de tentativas e a simulação sem seguimento. */
const EVENTOS_ANTES_DIAS = 60;

router.get("/vida/pipeline/resumo", (req, res, next) => {
  void (async () => {
    const q = periodoSchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "de e ate têm de ser YYYY-MM-DD" });
      return;
    }
    const agora = new Date();
    const hoje = todayLisbon(agora);
    const ate = q.data.ate ?? hoje;
    const de = q.data.de ?? segunda(ate);
    if (de > ate || somarDias(de, 92) < ate) {
      res.status(400).json({ error: "Período inválido (máximo 92 dias)" });
      return;
    }
    const inicio = lisbonInstant(de, 0);
    const [leads, eventos, agenda, categorias, pessoas, semNocrm, sincronizacao] = await Promise.all([
      repo.lerLeadsDoPainel(inicio),
      repo.lerEventos({ desde: new Date(inicio.getTime() - EVENTOS_ANTES_DIAS * 86_400_000) }),
      repo.lerAgenda(de, ate),
      repo.lerCategorias(),
      repo.lerPessoas(),
      repo.lerColaboradoresSemNocrm(),
      estadoSync(),
    ]);
    const resumo = calcularResumo({ de, ate, leads, eventos, agenda, categoriaDe: categorias, agora });
    const alertas = calcularAlertas({ leads, eventos, agendaRecente: await repo.lerAgenda(diaUtilAnterior(hoje), hoje), agora });
    const alertasPorPessoa: Record<string, number> = {};
    for (const a of alertas) alertasPorPessoa[String(a.userId)] = (alertasPorPessoa[String(a.userId)] ?? 0) + 1;

    res.json({
      ...resumo,
      hoje,
      pessoas: resumo.pessoas.map((p) => ({ ...p, alertas: alertasPorPessoa[String(p.userId)] ?? 0 })),
      totalAlertas: alertas.length,
      equipa: pessoas,
      colaboradoresSemNocrm: semNocrm,
      prazos: PRAZO_PASSO_DIAS,
      sincronizacao,
    });
  })().catch(next);
});

router.get("/vida/pipeline/colaborador/:userId", (req, res, next) => {
  void (async () => {
    const userId = Number(req.params.userId);
    const qd = z.object({ dia: DIA.optional() }).safeParse(req.query);
    if (!Number.isInteger(userId) || userId <= 0 || !qd.success) {
      res.status(400).json({ error: "userId inválido ou dia fora do formato YYYY-MM-DD" });
      return;
    }
    const agora = new Date();
    const hoje = todayLisbon(agora);
    const dia = qd.data.dia ?? hoje;
    const de = somarDias(dia, -27);
    const inicio = lisbonInstant(de, 0);

    const [leadsTodas, eventos, agenda, pessoas] = await Promise.all([
      repo.lerLeadsDoPainel(inicio),
      repo.lerEventos({ desde: new Date(inicio.getTime() - EVENTOS_ANTES_DIAS * 86_400_000) }),
      repo.lerAgenda(de, dia),
      repo.lerPessoas(),
    ]);
    const pessoa = pessoas.find((p) => p.userId === userId);
    if (!pessoa) {
      res.status(404).json({ error: "Utilizador do noCRM não encontrado" });
      return;
    }
    const minhas = leadsTodas.filter((l) => l.userId === userId);
    const porId = new Map(leadsTodas.map((l) => [l.id, l]));

    // Agenda do dia com estado.
    const doDia = agendaComEstado(agenda.filter((a) => a.dia === dia && a.userId === userId), eventos, agora)
      .map((a) => ({ ...a, titulo: porId.get(a.leadId)?.titulo ?? `Lead ${a.leadId}` }))
      .sort((x, y) => (x.hora ?? "99").localeCompare(y.hora ?? "99"));

    // Previsto vs feito nas últimas 4 semanas, por dia útil.
    const ag28 = agendaComEstado(agenda.filter((a) => a.userId === userId), eventos, agora);
    const porDia = new Map<string, { previsto: number; feito: number; tentou: number }>();
    for (const a of ag28) {
      const d = porDia.get(a.dia) ?? { previsto: 0, feito: 0, tentou: 0 };
      d.previsto++;
      if (a.estado === "feito") d.feito++;
      if (a.estado === "tentou") d.tentou++;
      porDia.set(a.dia, d);
    }
    const dias: { dia: string; previsto: number; feito: number; tentou: number }[] = [];
    for (let d = de; d <= dia; d = somarDias(d, 1)) {
      if (diaDaSemana(d) === 0 || diaDaSemana(d) === 6) continue;
      dias.push({ dia: d, ...(porDia.get(d) ?? { previsto: 0, feito: 0, tentou: 0 }) });
    }

    const abertas = minhas.filter(aberta);
    const atrasadas = abertas
      .filter((l) => atrasada(l, hoje))
      .map((l) => ({ leadId: l.id, titulo: l.titulo, passo: l.passo, proximaAcaoDia: l.proximaAcaoDia, proximaAcaoHora: l.proximaAcaoHora }))
      .sort((a, b) => (a.proximaAcaoDia ?? "").localeCompare(b.proximaAcaoDia ?? ""));
    const paradas = abertas
      .filter((l) => parada(l, agora))
      .map((l) => ({ leadId: l.id, titulo: l.titulo, passo: l.passo, dias: diasNoPasso(l, agora), prazo: l.passo ? (PRAZO_PASSO_DIAS[l.passo] ?? null) : null }))
      .sort((a, b) => b.dias - a.dias);

    const chamadas = eventos
      .filter((e) => e.tipo === "chamada" && e.userId === userId && toLisbonDate(e.ocorreuEm) === dia)
      .map((e) => ({
        id: e.id,
        leadId: e.leadId,
        titulo: porId.get(e.leadId)?.titulo ?? `Lead ${e.leadId}`,
        ocorreuEm: e.ocorreuEm.toISOString(),
        duracaoSeg: e.duracaoSeg,
        conversa: eConversa(e),
        tentativa: eTentativa(e),
        resumo: e.texto,
        gravacaoUrl: e.gravacaoUrl,
      }))
      .reverse();

    const alertas = calcularAlertas({ leads: leadsTodas, eventos, agendaRecente: agenda.filter((a) => a.dia >= diaUtilAnterior(hoje)), agora })
      .filter((a) => a.userId === userId)
      .map((a) => ({ ...a, nome: ALERTA_NOME[a.tipo] }));

    const funil = new Map<string, number>();
    for (const l of abertas) funil.set(l.passo ?? "Sem passo", (funil.get(l.passo ?? "Sem passo") ?? 0) + 1);

    res.json({
      pessoa,
      dia,
      hoje,
      carteira: abertas.length,
      funil: [...funil.entries()].map(([passo, total]) => ({ passo, total })),
      agenda: doDia,
      dias,
      atrasadas,
      paradas,
      chamadas,
      alertas,
    });
  })().catch(next);
});

router.get("/vida/pipeline/alertas", (_req, res, next) => {
  void (async () => {
    const agora = new Date();
    const hoje = todayLisbon(agora);
    const inicio = lisbonInstant(somarDias(hoje, -30), 0);
    const [leads, eventos, agenda, pessoas, sincronizacao] = await Promise.all([
      repo.lerLeadsDoPainel(inicio),
      repo.lerEventos({ desde: new Date(inicio.getTime() - EVENTOS_ANTES_DIAS * 86_400_000) }),
      repo.lerAgenda(diaUtilAnterior(hoje), hoje),
      repo.lerPessoas(),
      estadoSync(),
    ]);
    const nomes = new Map(pessoas.map((p) => [p.userId, p.nome]));
    const alertas = calcularAlertas({ leads, eventos, agendaRecente: agenda, agora }).map((a) => ({
      ...a,
      nome: ALERTA_NOME[a.tipo],
      pessoa: a.userId != null ? (nomes.get(a.userId) ?? `Utilizador ${a.userId}`) : null,
    }));
    const porTipo: Record<string, number> = {};
    for (const a of alertas) porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;
    res.json({ hoje, alertas, porTipo, tipos: ALERTA_NOME, sincronizacao });
  })().catch(next);
});

export default router;
