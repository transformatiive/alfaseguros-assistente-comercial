import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Colaborador } from "@workspace/db";

/**
 * Short-lived bearer tokens for the agent panel.
 *
 * HS256 JWTs, hand-rolled on `node:crypto` rather than pulling in a library:
 * we mint and verify with the same secret, in the same process, with a fixed
 * algorithm. There is no key discovery, no `alg` negotiation, and no RS256
 * path — which also means there is no `alg: none` confusion to defend against,
 * because the header is checked against a constant.
 *
 * 15 minutes is deliberate. The token travels through the Zoho widget and, on
 * the Desk path, through a URL fragment; it should be worthless by the time it
 * could leak out of a browser history.
 */

const TTL_SECONDS = 15 * 60;
const HEADER = { alg: "HS256", typ: "JWT" } as const;

export interface AgentTokenClaims {
  /** colaborador.id */
  sub: string;
  /** Zoho Desk agent id, when the colaborador has one. */
  zid: string | null;
  papel: "agente" | "supervisor" | "nenhum";
  equipa: string;
  nome: string;
  iat: number;
  exp: number;
  jti: string;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Mint a token for a colaborador. Throws if the secret is not configured. */
export function mintAgentToken(
  colaborador: Colaborador,
  secret: string | undefined,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  if (!secret) throw new Error("AGENT_TOKEN_SECRET não está configurado");
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + TTL_SECONDS;
  const claims: AgentTokenClaims = {
    sub: String(colaborador.id),
    zid: colaborador.zid ?? null,
    papel: colaborador.papel,
    equipa: colaborador.equipa,
    nome: colaborador.nome,
    iat,
    exp,
    jti: randomUUID(),
  };
  const payload = `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(claims))}`;
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: new Date(exp * 1000) };
}

export type VerifyFailure =
  | "sem-segredo"
  | "malformado"
  | "algoritmo-invalido"
  | "assinatura-invalida"
  | "expirado";

export type VerifyResult =
  | { ok: true; claims: AgentTokenClaims }
  | { ok: false; reason: VerifyFailure };

/** Verify a token. Never throws — the caller turns the reason into a status. */
export function verifyAgentToken(
  raw: string | undefined | null,
  secret: string | undefined,
  now: Date = new Date(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "sem-segredo" };
  if (!raw) return { ok: false, reason: "malformado" };

  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformado" };
  const [rawHeader, rawClaims, signature] = parts;

  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(rawHeader, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformado" };
  }
  // Pinned, not negotiated — `alg: none` and RS256 confusion both die here.
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "HS256"
  ) {
    return { ok: false, reason: "algoritmo-invalido" };
  }

  const expected = sign(`${rawHeader}.${rawClaims}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "assinatura-invalida" };
  }

  let claims: AgentTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(rawClaims, "base64url").toString("utf8")) as AgentTokenClaims;
  } catch {
    return { ok: false, reason: "malformado" };
  }
  if (typeof claims.exp !== "number" || typeof claims.sub !== "string") {
    return { ok: false, reason: "malformado" };
  }
  if (claims.exp * 1000 <= now.getTime()) return { ok: false, reason: "expirado" };

  return { ok: true, claims };
}
