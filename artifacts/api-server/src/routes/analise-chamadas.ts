/**
 * Análise de Chamadas · Visão geral — every Ringover call, by team.
 *
 *   GET  /api/analise-chamadas/geral?de=…&ate=…&equipa=…   (session)
 *   POST /api/analise-chamadas/sincronizar                 (X-Cron-Secret)
 *
 * The GET also starts, in the background, the pull of any day in the period
 * that was never synced. That is what lets a user pick an older period: the
 * first answer says which days are still missing, and the page asks again
 * until they arrive.
 */
import { Router, type IRouter, type RequestHandler } from "express";
import {
  agregarVisaoGeral,
  FILTROS_EQUIPA,
  resolverEquipa,
  type FiltroEquipa,
} from "../analise-chamadas/agregar.js";
import { isValidIsoDate, lisbonDateOffset, somarDias } from "../lib/dates.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import {
  carregarChamadasPeriodo,
  carregarRosterEquipas,
  diasSincronizados,
  limitesSincronizados,
} from "../storage/chamadas-ringover-repo.js";
import { sincronizarPeriodo } from "../jobs/sync-chamadas-ringover.js";

export const MAX_DIAS_PERIODO = 366;

/** Days a failed sync is left alone before a page view may retry it. */
const ESPERA_APOS_FALHA_MS = 60 * 60 * 1000;

let sincronizacaoEmCurso: Promise<unknown> | null = null;
const falhouEm = new Map<string, number>();

function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** Start (at most one at a time) the pull of the given days. Never awaited by the request. */
function sincronizarEmFundo(dias: string[]): boolean {
  const agora = Date.now();
  const elegiveis = dias.filter((d) => agora - (falhouEm.get(d) ?? 0) > ESPERA_APOS_FALHA_MS);
  if (elegiveis.length === 0 || !env().RINGOVER_API_KEY) return false;
  if (sincronizacaoEmCurso) return true;
  const de = elegiveis[0];
  const ate = elegiveis[elegiveis.length - 1];
  sincronizacaoEmCurso = sincronizarPeriodo(de, ate)
    .then((r) => {
      for (const d of r.falhados) falhouEm.set(d, Date.now());
    })
    .catch((err) => logger.warn({ err }, "análise de chamadas: sincronização em fundo falhou"))
    .finally(() => {
      sincronizacaoEmCurso = null;
    });
  return true;
}

export function lerPeriodo(query: Record<string, unknown>):
  | { ok: true; de: string; ate: string; equipa: FiltroEquipa }
  | { ok: false; erro: string } {
  const de = typeof query.de === "string" ? query.de : "";
  const ate = typeof query.ate === "string" ? query.ate : "";
  const equipaRaw = typeof query.equipa === "string" ? query.equipa : "todas";
  if (!isValidIsoDate(de) || !isValidIsoDate(ate)) {
    return { ok: false, erro: "Parâmetros 'de' e 'ate' (AAAA-MM-DD) são obrigatórios" };
  }
  if (de > ate) return { ok: false, erro: "'de' tem de ser anterior ou igual a 'ate'" };
  if (diasEntre(de, ate).length > MAX_DIAS_PERIODO) {
    return { ok: false, erro: `O período não pode ter mais de ${MAX_DIAS_PERIODO} dias` };
  }
  if (!(FILTROS_EQUIPA as readonly string[]).includes(equipaRaw)) {
    return { ok: false, erro: "Equipa inválida" };
  }
  return { ok: true, de, ate, equipa: equipaRaw as FiltroEquipa };
}

const router: IRouter = Router();

const requireCronSecret: RequestHandler = (req, res, next) => {
  const cfg = env();
  if (!cfg.CRON_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Cron secret not configured on server" });
    return;
  }
  if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
    res.status(401).json({ error: "Invalid X-Cron-Secret" });
    return;
  }
  next();
};

/** Ops: (re)pull a period from Ringover. Body: { de, ate, forcar? }. Answers at once, runs in background. */
export const sincronizarRouter: IRouter = Router();
sincronizarRouter.post("/analise-chamadas/sincronizar", requireCronSecret, (req, res): void => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const p = lerPeriodo({ de: body.de, ate: body.ate });
  if (!p.ok) {
    res.status(400).json({ error: p.erro });
    return;
  }
  const forcar = body.forcar === true;
  void sincronizarPeriodo(p.de, p.ate, { forcar })
    .then((r) => logger.info({ de: p.de, ate: p.ate, forcar, ...r }, "análise de chamadas: sincronização manual"))
    .catch((err) => logger.warn({ err }, "análise de chamadas: sincronização manual falhou"));
  res.status(202).json({ ok: true, de: p.de, ate: p.ate, forcar });
});

router.get("/analise-chamadas/geral", async (req, res): Promise<void> => {
  const p = lerPeriodo(req.query as Record<string, unknown>);
  if (!p.ok) {
    res.status(400).json({ error: p.erro });
    return;
  }

  // Only past days can be complete; today is pulled by tomorrow's run.
  const ontem = lisbonDateOffset(-1);
  const diasPassados = diasEntre(p.de, p.ate < ontem ? p.ate : ontem);
  const [feitos, roster, linhas, limites] = await Promise.all([
    diasSincronizados(diasPassados),
    carregarRosterEquipas(),
    carregarChamadasPeriodo(p.de, p.ate),
    limitesSincronizados(),
  ]);
  const emFalta = diasPassados.filter((d) => !feitos.has(d));
  const aSincronizar = emFalta.length > 0 && sincronizarEmFundo(emFalta);

  const chamadas = linhas.map((l) => ({
    ...l,
    direcao: l.direcao as "in" | "out",
    equipa: resolverEquipa(l.agenteId, l.agenteNome, roster),
  }));

  res.json({
    ...agregarVisaoGeral(chamadas, p.de, p.ate, p.equipa),
    cobertura: {
      diasEmFalta: emFalta.length,
      aSincronizar,
      primeiroDia: limites.primeiro,
      ultimoDia: limites.ultimo,
    },
  });
});

export default router;
