import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { generateSecret, verify as totpVerify, generateURI } from "otplib";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

const ISSUER = "Alfaseguros Supervisor Virtual";

/** Normalise and validate a TOTP token string, then verify it against the secret.
 *  Returns { valid: boolean } or throws a structured Error with `status` for bad input.
 */
async function safeVerifyTotp(
  secret: string,
  rawToken: string,
): Promise<{ valid: boolean }> {
  const token = rawToken.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) {
    const err = new Error("Formato de código inválido — deve ter 6 dígitos") as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }
  try {
    return await totpVerify({ secret, token });
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// Login / logout / me
// ---------------------------------------------------------------------------

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username e password obrigatórios" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username.trim().toLowerCase()));

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  // If 2FA is enabled, create a pending-only session (no userId/role/username)
  if (user.totpSecret) {
    delete req.session.userId;
    delete req.session.userRole;
    delete req.session.username;
    req.session.totpPending = true;
    req.session.totpUserId = user.id;
    res.json({ totpRequired: true });
    return;
  }

  // No 2FA — create a full session; clear any stale pending flags
  delete req.session.totpPending;
  delete req.session.totpUserId;
  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.username = user.username;

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req, res): void => {
  if (req.session?.totpPending) {
    res.status(403).json({ error: "Verificação em dois passos pendente" });
    return;
  }
  if (!req.session?.userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.userRole,
  });
});

// ---------------------------------------------------------------------------
// TOTP — verify during login (pending session → full session)
// ---------------------------------------------------------------------------

router.post("/auth/totp/verify", async (req, res): Promise<void> => {
  if (!req.session?.totpPending || !req.session.totpUserId) {
    res.status(400).json({ error: "Sem sessão de verificação TOTP activa" });
    return;
  }
  const totpUserId = req.session.totpUserId;

  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "Código obrigatório" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, totpUserId));

  if (!user?.totpSecret) {
    res.status(400).json({ error: "2FA não configurado" });
    return;
  }

  let verifyResult: { valid: boolean };
  try {
    verifyResult = await safeVerifyTotp(user.totpSecret, code);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 400).json({ error: err.message ?? "Código inválido" });
    return;
  }
  if (!verifyResult.valid) {
    res.status(401).json({ error: "Código inválido" });
    return;
  }

  // Promote to full session — clear pending flags then set full auth
  delete req.session.totpPending;
  delete req.session.totpUserId;
  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.username = user.username;

  res.json({ id: user.id, username: user.username, role: user.role });
});

// ---------------------------------------------------------------------------
// TOTP — setup (generate QR) and activate (confirm code + save secret)
// These require a fully authenticated session.
// ---------------------------------------------------------------------------

router.get("/auth/totp/setup", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Utilizador não encontrado" });
    return;
  }
  if (user.totpSecret) {
    res.status(409).json({ error: "2FA já está activo — desactive primeiro antes de reconfigurar" });
    return;
  }

  const secret = generateSecret();
  const otpauth = generateURI({ issuer: ISSUER, label: user.username, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  // Store server-generated secret in session; confirm step uses this, not client-provided value
  req.session.totpSetupSecret = secret;

  res.json({ secret, otpauth, qrDataUrl });
});

router.post("/auth/totp/setup", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;

  // Use the server-generated secret stored in session (ignore any client-provided secret)
  const secret = req.session.totpSetupSecret;
  if (!secret) {
    res.status(400).json({ error: "Sessão de configuração não encontrada — reinicie o processo" });
    return;
  }

  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "Código obrigatório" });
    return;
  }

  // Verify against server-held secret before persisting
  let setupVerifyResult: { valid: boolean };
  try {
    setupVerifyResult = await safeVerifyTotp(secret, code);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 400).json({ error: err.message ?? "Código inválido" });
    return;
  }
  if (!setupVerifyResult.valid) {
    res.status(401).json({ error: "Código inválido — verifique a app de autenticação" });
    return;
  }

  // Guard against enabling when already active (in case session is replayed)
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (user?.totpSecret) {
    delete req.session.totpSetupSecret;
    res.status(409).json({ error: "2FA já está activo" });
    return;
  }

  await db
    .update(usersTable)
    .set({ totpSecret: secret })
    .where(eq(usersTable.id, userId));

  // Clear setup secret from session once persisted
  delete req.session.totpSetupSecret;

  res.json({ ok: true });
});

router.delete("/auth/totp", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "Código obrigatório para desactivar 2FA" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.totpSecret) {
    res.status(400).json({ error: "2FA não está activo" });
    return;
  }

  let disableVerifyResult: { valid: boolean };
  try {
    disableVerifyResult = await safeVerifyTotp(user.totpSecret, code);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 400).json({ error: err.message ?? "Código inválido" });
    return;
  }
  if (!disableVerifyResult.valid) {
    res.status(401).json({ error: "Código inválido" });
    return;
  }

  await db
    .update(usersTable)
    .set({ totpSecret: null })
    .where(eq(usersTable.id, userId));

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Current user's 2FA status
// ---------------------------------------------------------------------------

router.get("/auth/totp/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [user] = await db
    .select({ totpEnabled: usersTable.totpSecret })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  res.json({ totpEnabled: !!user?.totpEnabled });
});

export default router;
