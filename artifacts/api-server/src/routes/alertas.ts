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
import { loadEligibleAlerts } from "../storage/repo.js";

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

interface AlertItem {
  conversationId: number;
  itemId: number;
  categoria: string;
  validacao: string;
  texto: string;
  mensagemMelhoria: string;
  motivo: "compliance" | "categoria_obrigatoria";
}

router.get("/alertas-dia", requireToken, async (req, res): Promise<void> => {
  const data =
    typeof req.query.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data)
      ? req.query.data
      : todayLisbon();

  const rows = await loadEligibleAlerts(data);

  // Group by operator for the digest (one email per operator).
  const byColaborador = new Map<
    string,
    { colaboradorId: number | null; nome: string | null; email: string | null; itens: AlertItem[] }
  >();

  for (const r of rows) {
    const key = r.colaboradorId != null ? String(r.colaboradorId) : `sem-colaborador`;
    const bucket =
      byColaborador.get(key) ??
      { colaboradorId: r.colaboradorId, nome: r.colaboradorNome, email: r.colaboradorEmail, itens: [] };
    bucket.itens.push({
      conversationId: r.conversationId,
      itemId: r.itemId,
      categoria: r.categoria,
      validacao: r.validacao,
      texto: r.texto,
      mensagemMelhoria: r.mensagemMelhoria,
      motivo: r.compliance ? "compliance" : "categoria_obrigatoria",
    });
    byColaborador.set(key, bucket);
  }

  res.json({
    data,
    total_incumprimentos: rows.length,
    colaboradores: [...byColaborador.values()],
  });
});

export default router;
