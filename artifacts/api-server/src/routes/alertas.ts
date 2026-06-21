/**
 * GET /api/alertas-dia?data=YYYY-MM-DD
 *
 * n8n-facing endpoint (same Bearer scheme as /api/followups and
 * /api/email/summary). Returns the day's eligible non-compliances grouped by
 * operator, ready for a single digest email per operator. Eligible =
 * estado nao_cumprido AND (category.obrigatoria OR item.compliance).
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { env } from "../lib/env.js";
import {
  loadEligibleAlerts,
  confirmarAlertas,
  loadPointEvaluations,
  loadCategorias,
  loadChecklistForPrompt,
} from "../storage/repo.js";
import {
  computeAllCategoryStats,
  MIN_CHAMADAS_PADRAO_DEFAULT,
} from "../analysis/category-stats.js";
import {
  renderColaboradorDigest,
  renderEquipaResumo,
  type ResumoCategoria,
} from "../lib/email-template.js";

const router: IRouter = Router();

const requireToken: RequestHandler = (req, res, next) => {
  const token = env().FOLLOWUP_API_TOKEN;
  if (!token) {
    res.status(503).json({ error: "FOLLOWUP_API_TOKEN not configured on server" });
    return;
  }
  if (req.headers["authorization"] !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

function todayLisbon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/** A failed point, aggregated across the operator's calls for the day. */
interface AlertPoint {
  itemId: number;
  categoria: string;
  validacao: string;
  texto: string;
  mensagemMelhoria: string;
  motivo: "compliance" | "categoria_obrigatoria";
  chamadas_falhadas: number;
  exemplos: number[]; // up to 3 conversation ids for drill-down links
}

const MAX_EXEMPLOS = 3;

router.get("/alertas-dia", requireToken, async (req, res): Promise<void> => {
  const data =
    typeof req.query.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data)
      ? req.query.data
      : todayLisbon();

  const rows = await loadEligibleAlerts(data);

  // Two-level grouping: operator → point. The digest lists each failed POINT
  // once (with how many calls it failed + a few example calls), not one line
  // per (call, point) — otherwise an operator gets dozens of repeated lines.
  const byColaborador = new Map<
    string,
    {
      colaboradorId: number | null;
      nome: string | null;
      email: string | null;
      pontos: Map<number, AlertPoint>;
    }
  >();

  for (const r of rows) {
    const key = r.colaboradorId != null ? String(r.colaboradorId) : "sem-colaborador";
    const bucket =
      byColaborador.get(key) ??
      { colaboradorId: r.colaboradorId, nome: r.colaboradorNome, email: r.colaboradorEmail, pontos: new Map() };

    const ponto =
      bucket.pontos.get(r.itemId) ??
      {
        itemId: r.itemId,
        categoria: r.categoria,
        validacao: r.validacao,
        texto: r.texto,
        mensagemMelhoria: r.mensagemMelhoria,
        motivo: (r.compliance ? "compliance" : "categoria_obrigatoria") as AlertPoint["motivo"],
        chamadas_falhadas: 0,
        exemplos: [],
      };
    ponto.chamadas_falhadas += 1;
    if (ponto.exemplos.length < MAX_EXEMPLOS) ponto.exemplos.push(r.conversationId);
    bucket.pontos.set(r.itemId, ponto);
    byColaborador.set(key, bucket);
  }

  const colaboradores = [...byColaborador.values()].map((b) => {
    // Compliance first, then by frequency — most actionable at the top.
    const pontos = [...b.pontos.values()].sort(
      (a, c) =>
        Number(c.motivo === "compliance") - Number(a.motivo === "compliance") ||
        c.chamadas_falhadas - a.chamadas_falhadas,
    );
    return {
      colaboradorId: b.colaboradorId,
      nome: b.nome,
      email: b.email,
      total_pontos: pontos.length,
      pontos,
      // Ready-to-send branded HTML (logo + cards) so n8n just forwards it.
      htmlEmail: renderColaboradorDigest({
        nome: b.nome ?? "colega",
        data,
        pontos: pontos.map((p) => ({
          validacao: p.validacao,
          chamadas_falhadas: p.chamadas_falhadas,
          motivo: p.motivo,
          mensagemMelhoria: p.mensagemMelhoria,
        })),
      }),
    };
  });

  res.json({
    data,
    total_incumprimentos: rows.length,
    colaboradores,
  });
});

function minChamadas(): number {
  const raw = process.env["MIN_CHAMADAS_PADRAO"];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MIN_CHAMADAS_PADRAO_DEFAULT;
}

/**
 * GET /api/resumo-checklist-dia?data=YYYY-MM-DD
 * Coordinator team summary (dashboard-style, branded HTML) for the Vida lead.
 */
router.get("/resumo-checklist-dia", requireToken, async (req, res): Promise<void> => {
  const data =
    typeof req.query.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data)
      ? req.query.data
      : todayLisbon();

  const [evals, cats, items] = await Promise.all([
    loadPointEvaluations({ de: data, ate: data }),
    loadCategorias("vida", "primeiro_contacto"),
    loadChecklistForPrompt("vida", "primeiro_contacto"),
  ]);
  const itemNome = new Map(items.map((i) => [i.id, i.validacao || i.texto]));
  const catMeta = new Map(cats.map((c) => [c.id, c]));
  const stats = computeAllCategoryStats(evals, { minChamadas: minChamadas() });

  let cumprido = 0;
  let aplicavel = 0;
  let chamadas = 0;
  const categorias: ResumoCategoria[] = stats.map((s) => {
    cumprido += s.cumprido;
    aplicavel += s.aplicavel;
    chamadas = Math.max(chamadas, s.cobertura);
    const meta = catMeta.get(s.categoryId);
    return {
      nome: meta?.nome ?? `Categoria ${s.categoryId}`,
      obrigatoria: meta?.obrigatoria ?? false,
      taxaPercent: s.exibePercentagem && s.taxa !== null ? Math.round(s.taxa * 100) : null,
      exibePercentagem: s.exibePercentagem,
      absoluto: s.absoluto,
      cobertura: s.cobertura,
      cumprido: s.cumprido,
      naoCumprido: s.naoCumprido,
      pontoMaisFracoNome: s.pontoMaisFraco ? (itemNome.get(s.pontoMaisFraco.itemId) ?? null) : null,
    };
  });

  const taxaPct = aplicavel > 0 ? Math.round((cumprido / aplicavel) * 100) : null;
  const naoCumprido = aplicavel - cumprido;
  const htmlEmail = renderEquipaResumo({ data, kpis: { chamadas, taxaPct, naoCumprido }, categorias });

  res.json({ data, kpis: { chamadas, taxaPct, cumprido, naoCumprido }, categorias, htmlEmail });
});

/**
 * POST /api/alertas-dia/confirmar?data=YYYY-MM-DD
 * Called by n8n after the digest is sent: records the day's eligible alerts in
 * alert_log so they are never re-sent (idempotency, incl. force re-analysis).
 */
router.post("/alertas-dia/confirmar", requireToken, async (req, res): Promise<void> => {
  const data =
    typeof req.query.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data)
      ? req.query.data
      : todayLisbon();
  const marcados = await confirmarAlertas(data);
  res.json({ data, marcados });
});

export default router;
