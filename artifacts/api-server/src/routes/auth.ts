import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { generateSecret, verify as totpVerify, generateURI } from "otplib";
import QRCode from "qrcode";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, usersTable, recoveryCodesTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

const ISSUER = "Alfaseguros Supervisor Virtual";
const RECOVERY_CODE_COUNT = 8;

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

/** Generate a plaintext recovery code in the format `xxxxx-xxxxx`. */
function generatePlaintextCode(): string {
  const part1 = randomBytes(3).toString("hex"); // 6 hex chars
  const part2 = randomBytes(3).toString("hex"); // 6 hex chars
  return `${part1}-${part2}`;
}

/** Normalise a recovery code input: strip whitespace and hyphens, lowercase. */
function normaliseRecoveryCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toLowerCase();
}

/**
 * Pre-generate plaintext codes and their bcrypt hashes.
 * This is intentionally done outside any DB transaction so we don't hold a
 * connection open while running the expensive bcrypt rounds.
 */
async function buildCodeHashes(): Promise<Array<{ plain: string; hash: string }>> {
  const result: Array<{ plain: string; hash: string }> = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const plain = generatePlaintextCode();
    const hash = await bcrypt.hash(normaliseRecoveryCode(plain), 10);
    result.push({ plain, hash });
  }
  return result;
}

/**
 * Atomically replace all recovery codes for a user inside a DB transaction.
 * Call `buildCodeHashes()` first (outside the transaction) to prepare the hashes.
 */
async function replaceRecoveryCodesInTx(
  userId: number,
  codes: Array<{ plain: string; hash: string }>,
): Promise<string[]> {
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodesTable).where(eq(recoveryCodesTable.userId, userId));
    await tx
      .insert(recoveryCodesTable)
      .values(codes.map(({ hash }) => ({ userId, codeHash: hash })));
  });
  return codes.map(({ plain }) => plain);
}

/** Generate, hash, and atomically store 8 fresh recovery codes. */
async function generateAndStoreRecoveryCodes(userId: number): Promise<string[]> {
  const codes = await buildCodeHashes();
  return replaceRecoveryCodesInTx(userId, codes);
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
// Recovery code — verify during login (alternative to TOTP)
// ---------------------------------------------------------------------------

router.post("/auth/totp/recover", async (req, res): Promise<void> => {
  if (!req.session?.totpPending || !req.session.totpUserId) {
    res.status(400).json({ error: "Sem sessão de verificação TOTP activa" });
    return;
  }
  const totpUserId = req.session.totpUserId;

  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "Código de recuperação obrigatório" });
    return;
  }

  const normalisedInput = normaliseRecoveryCode(code);
  if (normalisedInput.length < 6) {
    res.status(400).json({ error: "Código de recuperação inválido" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, totpUserId));
  if (!user) {
    res.status(400).json({ error: "Utilizador não encontrado" });
    return;
  }

  // Fetch all unused codes for this user
  const unusedCodes = await db
    .select()
    .from(recoveryCodesTable)
    .where(
      and(
        eq(recoveryCodesTable.userId, totpUserId),
        isNull(recoveryCodesTable.usedAt),
      ),
    );

  if (unusedCodes.length === 0) {
    res.status(401).json({ error: "Sem códigos de recuperação disponíveis" });
    return;
  }

  // Check against each stored hash
  let matchedCode: (typeof unusedCodes)[number] | null = null;
  for (const stored of unusedCodes) {
    if (await bcrypt.compare(normalisedInput, stored.codeHash)) {
      matchedCode = stored;
      break;
    }
  }

  if (!matchedCode) {
    res.status(401).json({ error: "Código de recuperação inválido" });
    return;
  }

  // Atomically mark code as used — the WHERE used_at IS NULL guard ensures
  // only one concurrent request can consume the code, preventing replay attacks.
  const consumed = await db
    .update(recoveryCodesTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodesTable.id, matchedCode.id),
        isNull(recoveryCodesTable.usedAt),
      ),
    )
    .returning({ id: recoveryCodesTable.id });

  if (consumed.length === 0) {
    // Another concurrent request already consumed this code
    res.status(401).json({ error: "Código de recuperação inválido" });
    return;
  }

  // Promote to full session
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

  // Pre-generate hashes outside the transaction (avoids holding DB connection during bcrypt)
  const codeHashes = await buildCodeHashes();

  // Atomically activate 2FA and store recovery codes
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ totpSecret: secret })
      .where(eq(usersTable.id, userId));
    await tx.delete(recoveryCodesTable).where(eq(recoveryCodesTable.userId, userId));
    await tx
      .insert(recoveryCodesTable)
      .values(codeHashes.map(({ hash }) => ({ userId, codeHash: hash })));
  });

  const recoveryCodes = codeHashes.map(({ plain }) => plain);

  // Clear setup secret from session once persisted
  delete req.session.totpSetupSecret;

  res.json({ ok: true, recoveryCodes });
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

  // Atomically clear the TOTP secret and remove all recovery codes
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ totpSecret: null })
      .where(eq(usersTable.id, userId));
    await tx.delete(recoveryCodesTable).where(eq(recoveryCodesTable.userId, userId));
  });

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

// ---------------------------------------------------------------------------
// Recovery codes — count remaining & regenerate
// ---------------------------------------------------------------------------

router.get("/auth/recovery-codes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;

  // Only meaningful if 2FA is active
  const [user] = await db
    .select({ totpEnabled: usersTable.totpSecret })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.totpEnabled) {
    res.json({ totpEnabled: false, remaining: 0 });
    return;
  }

  const unused = await db
    .select({ id: recoveryCodesTable.id })
    .from(recoveryCodesTable)
    .where(
      and(
        eq(recoveryCodesTable.userId, userId),
        isNull(recoveryCodesTable.usedAt),
      ),
    );

  res.json({ totpEnabled: true, remaining: unused.length });
});

router.post("/auth/recovery-codes/regenerate", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;

  const [user] = await db
    .select({ totpEnabled: usersTable.totpSecret })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.totpEnabled) {
    res.status(400).json({ error: "2FA não está activo" });
    return;
  }

  const recoveryCodes = await generateAndStoreRecoveryCodes(userId);

  res.json({ recoveryCodes });
});

export default router;
