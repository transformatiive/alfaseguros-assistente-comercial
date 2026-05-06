import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  // Reject sessions that are still waiting for TOTP verification
  if (req.session.totpPending) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (req.session.totpPending) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (req.session.userRole !== "admin") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  next();
};
