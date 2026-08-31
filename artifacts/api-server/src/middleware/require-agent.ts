import type { RequestHandler, Request } from "express";
import { env } from "../lib/env.js";
import { verifyAgentToken, type AgentTokenClaims } from "../painel/token.js";

/**
 * Bearer-token guards for the agent panel. Deliberately separate from
 * `requireAuth`: the supervisor SPA uses a session cookie, the panel uses a
 * short-lived token minted from the Zoho identity. Neither can stand in for
 * the other, and this file does not touch the session at all.
 */

/**
 * The verified claims are hung off the request. Module augmentation of
 * `express-serve-static-core` is avoided on purpose: that package is a
 * transitive type-only dependency and is not resolvable from this workspace,
 * so the augmentation silently fails to apply. An explicit type that handlers
 * accept is clearer and cannot go quietly wrong.
 */
export type AgenteRequest = Request & { agente?: AgentTokenClaims };

/** Read the verified claims, throwing if the guard did not run first. */
export function agenteDe(req: Request): AgentTokenClaims {
  const claims = (req as AgenteRequest).agente;
  if (!claims) throw new Error("requireAgent não correu antes deste handler");
  return claims;
}

function bearer(req: Request): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export const requireAgent: RequestHandler = (req, res, next) => {
  const result = verifyAgentToken(bearer(req), env().AGENT_TOKEN_SECRET);
  if (!result.ok) {
    if (result.reason === "sem-segredo") {
      res.status(503).json({ error: "Painel do agente não está configurado no servidor" });
      return;
    }
    // Everything else is a 401 with the same body: a caller learns only that
    // the token is unusable, not which check rejected it.
    res.status(401).json({ error: "Sessão expirada" });
    return;
  }
  if (result.claims.papel === "nenhum") {
    res.status(403).json({ error: "Sem acesso ao painel" });
    return;
  }
  (req as AgenteRequest).agente = result.claims;
  next();
};

export const requireSupervisor: RequestHandler = (req, res, next) => {
  requireAgent(req, res, () => {
    if ((req as AgenteRequest).agente?.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }
    next();
  });
};
