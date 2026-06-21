import { Router, type IRouter } from "express";
import {
  loadPointEvaluations,
  loadCategorias,
  loadColaboradores,
  loadConversationBasic,
  loadChecklistResultsForConversation,
  type CategoriaMeta,
} from "../storage/repo.js";
import {
  computeAllCategoryStats,
  MIN_CHAMADAS_PADRAO_DEFAULT,
  type CategoryStats,
} from "../analysis/category-stats.js";

const router: IRouter = Router();

const ESCOPO_VIDA = "vida";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function minChamadas(): number {
  const raw = process.env["MIN_CHAMADAS_PADRAO"];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MIN_CHAMADAS_PADRAO_DEFAULT;
}

/** Validate ?de & ?ate; returns null + sends 400 when invalid. */
function readPeriod(req: { query: Record<string, unknown> }, res: import("express").Response): { de: string; ate: string } | null {
  const de = typeof req.query.de === "string" ? req.query.de : "";
  const ate = typeof req.query.ate === "string" ? req.query.ate : "";
  if (!DATE_RE.test(de) || !DATE_RE.test(ate)) {
    res.status(400).json({ error: "Parâmetros 'de' e 'ate' (YYYY-MM-DD) são obrigatórios" });
    return null;
  }
  return { de, ate };
}

/** Merge aggregated stats with category names/obrigatoriedade for the UI. */
function enrich(stats: CategoryStats[], cats: CategoriaMeta[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  return stats.map((s) => {
    const meta = byId.get(s.categoryId);
    return {
      ...s,
      nome: meta?.nome ?? `Categoria ${s.categoryId}`,
      obrigatoria: meta?.obrigatoria ?? false,
      // Honesty guardrail surfaced explicitly: only send the % when allowed.
      taxaPercent: s.exibePercentagem && s.taxa !== null ? Math.round(s.taxa * 100) : null,
    };
  });
}

// GET /api/stats/categoria?de&ate&colaborador_id
router.get("/stats/categoria", async (req, res): Promise<void> => {
  const period = readPeriod(req, res);
  if (!period) return;
  const colaboradorIdRaw = typeof req.query.colaborador_id === "string" ? Number.parseInt(req.query.colaborador_id, 10) : NaN;
  const colaboradorId = Number.isFinite(colaboradorIdRaw) ? colaboradorIdRaw : undefined;

  const [evals, cats] = await Promise.all([
    loadPointEvaluations({ de: period.de, ate: period.ate, colaboradorId }),
    loadCategorias(ESCOPO_VIDA, "primeiro_contacto"),
  ]);
  const stats = computeAllCategoryStats(evals, { minChamadas: minChamadas() });
  res.json({ de: period.de, ate: period.ate, minChamadas: minChamadas(), categorias: enrich(stats, cats) });
});

// GET /api/stats/equipa?de&ate — team aggregate incl. dispersion
router.get("/stats/equipa", async (req, res): Promise<void> => {
  const period = readPeriod(req, res);
  if (!period) return;
  const [evals, cats] = await Promise.all([
    loadPointEvaluations({ de: period.de, ate: period.ate }),
    loadCategorias(ESCOPO_VIDA, "primeiro_contacto"),
  ]);
  const stats = computeAllCategoryStats(evals, { minChamadas: minChamadas() });
  res.json({ de: period.de, ate: period.ate, minChamadas: minChamadas(), categorias: enrich(stats, cats) });
});

// GET /api/stats/colaborador?de&ate — per-operator breakdown
router.get("/stats/colaborador", async (req, res): Promise<void> => {
  const period = readPeriod(req, res);
  if (!period) return;
  const [evals, cats, colaboradores] = await Promise.all([
    loadPointEvaluations({ de: period.de, ate: period.ate }),
    loadCategorias(ESCOPO_VIDA, "primeiro_contacto"),
    loadColaboradores(ESCOPO_VIDA),
  ]);

  const evalsByColaborador = new Map<number, typeof evals>();
  for (const e of evals) {
    if (e.colaboradorId == null) continue;
    const list = evalsByColaborador.get(e.colaboradorId) ?? [];
    list.push(e);
    evalsByColaborador.set(e.colaboradorId, list);
  }

  const out = colaboradores.map((c) => {
    const stats = computeAllCategoryStats(evalsByColaborador.get(c.id) ?? [], { minChamadas: minChamadas() });
    return {
      colaboradorId: c.id,
      nome: c.nome,
      categorias: enrich(stats, cats),
    };
  });

  res.json({ de: period.de, ate: period.ate, minChamadas: minChamadas(), colaboradores: out });
});

// GET /api/chamada/:callId — drill-down: narrative + per-point states
router.get("/chamada/:callId", async (req, res): Promise<void> => {
  const id = Number.parseInt(req.params.callId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "callId inválido" });
    return;
  }
  const conv = await loadConversationBasic(id);
  if (!conv) {
    // R6: clear message, no unhandled error.
    res.status(404).json({ error: "Análise não disponível para esta chamada" });
    return;
  }
  const checklist = await loadChecklistResultsForConversation(id);
  res.json({
    id: conv.id,
    customerPhone: conv.customerPhone,
    agentName: conv.agentName,
    runDate: conv.runDate,
    faseDetectada: conv.faseDetectada,
    colaboradorId: conv.colaboradorId,
    analysis: conv.analysisJson ?? null,
    checklist,
  });
});

export default router;
