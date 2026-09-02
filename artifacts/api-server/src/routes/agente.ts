import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { todayLisbon } from "../lib/dates.js";
import { mintAgentToken } from "../painel/token.js";
import { resolveColaborador, loadColaboradorAtivo } from "../painel/identity.js";
import { requireAgent, requireSupervisor, agenteDe } from "../middleware/require-agent.js";
import {
  listDevolucoesPendentes,
  concluirDevolucao,
} from "../storage/devolucoes-repo.js";

import { buildAgentePainel } from "../painel/agente.js";
import { buildSupervisorPainel } from "../painel/supervisor.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/agente/sessao — exchange a Zoho identity for a 15-minute token
// ---------------------------------------------------------------------------

/**
 * Rate limit for the mint endpoint: 30 requests per minute per IP.
 * In-memory and per-process on purpose — this is a brake on a widget looping
 * or someone probing identities, not a security boundary. The widget-token
 * guard is the boundary.
 */
const MINT_WINDOW_MS = 60_000;
const MINT_MAX = 30;
const mintHits = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()): boolean {
  const hits = (mintHits.get(ip) ?? []).filter((t) => now - t < MINT_WINDOW_MS);
  hits.push(now);
  mintHits.set(ip, hits);
  if (mintHits.size > 5_000) mintHits.clear(); // crude guard against unbounded growth
  return hits.length > MINT_MAX;
}

const sessaoBodySchema = z.object({
  deskUserId: z.string().optional(),
  crmUserId: z.string().optional(),
  email: z.string().optional(),
  portalId: z.string().optional(),
  orgId: z.string().optional(),
  source: z.enum(["desk", "crm"]).optional(),
});

router.post("/agente/sessao", (req, res, next) => {
  void (async () => {
    const cfg = env();

    const widgetToken = cfg.PAINEL_WIDGET_TOKEN;
    if (!widgetToken || !cfg.AGENT_TOKEN_SECRET) {
      res.status(503).json({ error: "Painel do agente não está configurado no servidor" });
      return;
    }
    if (req.headers["x-painel-widget-token"] !== widgetToken) {
      res.status(401).json({ error: "Widget não autorizado" });
      return;
    }

    const ip = req.ip ?? "desconhecido";
    if (rateLimited(ip)) {
      res.status(429).json({ error: "Demasiados pedidos" });
      return;
    }

    const parsed = sessaoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Pedido inválido" });
      return;
    }
    const body = parsed.data;

    // The widget reports which Zoho org it is running in. If that is not the
    // Alfaseguros org, the caller is not our widget however valid its token.
    const orgEsperada = cfg.ZOHO_DESK_ORG_ID;
    const orgRecebida = body.portalId ?? body.orgId;
    if (orgEsperada && orgRecebida && orgRecebida !== orgEsperada) {
      logger.warn(
        { orgRecebida, source: body.source },
        "painel: pedido de sessão de uma organização Zoho inesperada",
      );
      res.status(403).json({ error: "Organização não autorizada" });
      return;
    }

    const colaborador = await resolveColaborador({
      deskUserId: body.deskUserId,
      crmUserId: body.crmUserId,
      email: body.email,
    });

    if (!colaborador) {
      // Logged with the *requested* identity so a missing zid is diagnosable
      // without having to ask the agent what they saw.
      logger.warn(
        { deskUserId: body.deskUserId, crmUserId: body.crmUserId, email: body.email },
        "painel: identidade Zoho sem colaborador ativo correspondente",
      );
      res.status(403).json({ error: "Colaborador não reconhecido" });
      return;
    }
    if (colaborador.papel === "nenhum") {
      res.status(403).json({ error: "Sem acesso ao painel" });
      return;
    }

    const { token, expiresAt } = mintAgentToken(colaborador, cfg.AGENT_TOKEN_SECRET);
    logger.info(
      {
        pedido: { deskUserId: body.deskUserId, crmUserId: body.crmUserId, email: body.email },
        resolvido: { id: colaborador.id, nome: colaborador.nome, papel: colaborador.papel },
        source: body.source,
      },
      "painel: token emitido",
    );

    res.json({
      token,
      expiraEm: expiresAt.toISOString(),
      colaborador: {
        id: colaborador.id,
        nome: colaborador.nome,
        papel: colaborador.papel,
        equipa: colaborador.equipa,
      },
    });
  })().catch(next);
});

// ---------------------------------------------------------------------------
// Chamadas por devolver
// ---------------------------------------------------------------------------

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

const resolveData: RequestHandler = (req, res, next) => {
  const raw = req.query.data;
  if (raw !== undefined && (typeof raw !== "string" || !DATA_RE.test(raw))) {
    res.status(400).json({ error: "Parâmetro `data` inválido (use YYYY-MM-DD)" });
    return;
  }
  next();
};

router.get("/agente/devolucoes", requireAgent, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();
    const rows = await listDevolucoesPendentes(Number(claims.sub), data);
    res.json({
      data,
      devolucoes: rows.map((r) => ({
        id: r.id,
        numeroCliente: r.numeroCliente,
        horaChamada: r.horaChamada.toISOString(),
        contexto: r.contexto,
      })),
    });
  })().catch(next);
});

const concluirBodySchema = z.object({
  estado: z.enum(["devolvida", "dispensada"]),
});

router.post("/agente/devolucoes/:id/concluir", requireAgent, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const parsed = concluirBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Estado inválido" });
      return;
    }

    const resultado = await concluirDevolucao({
      id,
      colaboradorId: Number(claims.sub),
      estado: parsed.data.estado,
    });

    switch (resultado.estado) {
      case "de-outro-agente":
        logger.warn(
          { devolucaoId: id, colaboradorId: claims.sub },
          "painel: tentativa de resolver uma devolução de outro colaborador",
        );
        res.status(403).json({ error: "Esta devolução pertence a outro colaborador" });
        return;
      case "inexistente":
        res.status(404).json({ error: "Devolução não encontrada" });
        return;
      case "ja-resolvida":
        res.status(409).json({ error: "Devolução já resolvida" });
        return;
      case "ok":
        res.json({
          id: resultado.row.id,
          estado: resultado.row.estado,
          // Other attempts from the same number, closed by the same click.
          tambemResolvidas: resultado.tambemResolvidas,
        });
        return;
    }
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/agente/painel — the four blocks
// ---------------------------------------------------------------------------

router.get("/agente/painel", requireAgent, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();

    // Re-read the colaborador rather than trusting the token: a 15-minute token
    // must not outlive a deactivation, and the panel needs fields the token
    // does not carry.
    const colaborador = await loadColaboradorAtivo(Number(claims.sub));
    if (!colaborador || colaborador.papel === "nenhum") {
      res.status(403).json({ error: "Sem acesso ao painel" });
      return;
    }

    const { painel, erros } = await buildAgentePainel(colaborador, data);
    for (const erro of erros) {
      logger.error({ err: erro, colaboradorId: colaborador.id, data }, "painel: bloco falhou");
    }
    res.json(painel);
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/supervisor/painel — the team view
// ---------------------------------------------------------------------------

router.get("/supervisor/painel", requireSupervisor, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();

    // Re-read rather than trust the token, exactly as the agent panel does:
    // demoting a supervisor must take effect now, not in up to 15 minutes.
    const colaborador = await loadColaboradorAtivo(Number(claims.sub));
    if (!colaborador || colaborador.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }

    res.json(await buildSupervisorPainel(data));
  })().catch(next);
});

export default router;
