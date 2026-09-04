import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, colaboradoresTable } from "@workspace/db";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { todayLisbon } from "../lib/dates.js";
import { loadColaboradorAtivo } from "../painel/identity.js";
import { buildAgentePainel } from "../painel/agente.js";
import { buildSupervisorPainel } from "../painel/supervisor.js";

/**
 * Read-only preview of the panel, with no token.
 *
 * Why it exists: the panel can only be opened with a 15-minute token minted by
 * a Zoho widget that is not installed yet. Reviewing a layout and its content
 * is a conversation longer than fifteen minutes, and re-minting mid-sentence is
 * not review, it is administration.
 *
 * Why it is dangerous, stated plainly rather than buried: while enabled, anyone
 * with the URL reads customer phone numbers, call context and ticket subjects,
 * for any agent. It is off unless `PAINEL_PREVIEW_ENABLED=1`, it never writes,
 * and it must be switched off once the extension works — one variable, no
 * deploy.
 *
 * Read-only is enforced by what is mounted, not by convention: this router
 * declares no POST and never imports a write function.
 */

const router: IRouter = Router();

function ligado(): boolean {
  return env().PAINEL_PREVIEW_ENABLED === "1";
}

router.use((req, res, next) => {
  if (!ligado()) {
    // 404 rather than 403: a disabled preview should look like a route that
    // does not exist, not like one worth attacking.
    res.status(404).json({ error: "Pré-visualização desligada" });
    return;
  }
  // Logged on every request, because a door left open should be visible to
  // whoever later asks "was this reachable, and by whom".
  logger.info({ caminho: req.path, ip: req.ip }, "painel: acesso à pré-visualização");
  next();
});

/** Who can be previewed. Name and role only — no identifiers worth stealing. */
router.get("/agente/pre-visualizacao/colaboradores", (_req, res, next) => {
  void (async () => {
    const rows = await db
      .select({
        id: colaboradoresTable.id,
        nome: colaboradoresTable.nome,
        papel: colaboradoresTable.papel,
      })
      .from(colaboradoresTable)
      .where(eq(colaboradoresTable.ativo, true))
      .orderBy(asc(colaboradoresTable.nome));
    res.json({ colaboradores: rows });
  })().catch(next);
});

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function diaPedido(valor: unknown): string {
  return typeof valor === "string" && DATA_RE.test(valor) ? valor : todayLisbon();
}

router.get("/agente/pre-visualizacao/painel", (req, res, next) => {
  void (async () => {
    const id = Number(req.query.colaboradorId);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "colaboradorId inválido" });
      return;
    }
    const data = diaPedido(req.query.data);

    const colaborador = await loadColaboradorAtivo(id);
    if (!colaborador) {
      res.status(404).json({ error: "Colaborador não encontrado" });
      return;
    }

    // Exactly the same builder the real panel uses. A preview built from a
    // second code path would validate a layout that nobody will ever see.
    const { painel, erros } = await buildAgentePainel(colaborador, data);
    for (const erro of erros) {
      logger.error({ err: erro, colaboradorId: id, data }, "pré-visualização: bloco falhou");
    }
    res.json(painel);
  })().catch(next);
});

router.get("/agente/pre-visualizacao/equipa", (req, res, next) => {
  void (async () => {
    res.json(await buildSupervisorPainel(diaPedido(req.query.data)));
  })().catch(next);
});

export default router;
