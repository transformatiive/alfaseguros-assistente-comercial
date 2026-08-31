import { describe, it, expect } from "vitest";
import { mintAgentToken, verifyAgentToken } from "./token.js";
import type { Colaborador } from "@workspace/db";

const SEGREDO = "segredo-de-teste-suficientemente-longo";

function colaborador(over: Partial<Colaborador> = {}): Colaborador {
  return {
    id: 7,
    nome: "Ana Silva",
    ringoverUserId: "23275677",
    zid: "367662000000123456",
    crmUserId: null,
    email: "ana@alfaseguros.pt",
    telefone: null,
    equipa: "360",
    papel: "agente",
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Colaborador;
}

describe("mintAgentToken / verifyAgentToken", () => {
  it("round-trips the claims", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    const r = verifyAgentToken(token, SEGREDO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claims.sub).toBe("7");
    expect(r.claims.zid).toBe("367662000000123456");
    expect(r.claims.papel).toBe("agente");
    expect(r.claims.equipa).toBe("360");
  });

  it("expires after 15 minutes", () => {
    const t0 = new Date("2026-08-28T09:00:00Z");
    const { token, expiresAt } = mintAgentToken(colaborador(), SEGREDO, t0);
    expect(expiresAt.toISOString()).toBe("2026-08-28T09:15:00.000Z");
    expect(verifyAgentToken(token, SEGREDO, new Date("2026-08-28T09:14:59Z")).ok).toBe(true);
    const late = verifyAgentToken(token, SEGREDO, new Date("2026-08-28T09:15:01Z"));
    expect(late).toEqual({ ok: false, reason: "expirado" });
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    expect(verifyAgentToken(token, "outro-segredo")).toEqual({
      ok: false,
      reason: "assinatura-invalida",
    });
  });

  it("rejects a tampered payload", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    const [h, p, s] = token.split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    claims.papel = "supervisor";
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${s}`;
    expect(verifyAgentToken(forged, SEGREDO)).toEqual({
      ok: false,
      reason: "assinatura-invalida",
    });
  });

  it('rejects "alg": "none" outright', () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({ sub: "7", papel: "supervisor", exp: 4102444800 }),
    ).toString("base64url");
    expect(verifyAgentToken(`${header}.${claims}.`, SEGREDO)).toEqual({
      ok: false,
      reason: "algoritmo-invalido",
    });
  });

  it("rejects malformed input and refuses to work without a secret", () => {
    expect(verifyAgentToken("nao-e-um-jwt", SEGREDO).ok).toBe(false);
    expect(verifyAgentToken("", SEGREDO)).toEqual({ ok: false, reason: "malformado" });
    expect(verifyAgentToken(undefined, SEGREDO)).toEqual({ ok: false, reason: "malformado" });
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    expect(verifyAgentToken(token, undefined)).toEqual({ ok: false, reason: "sem-segredo" });
  });

  it("refuses to mint without a secret rather than using a default", () => {
    expect(() => mintAgentToken(colaborador(), undefined)).toThrow(/AGENT_TOKEN_SECRET/);
  });

  it("carries papel = supervisor when the colaborador has it", () => {
    const { token } = mintAgentToken(colaborador({ papel: "supervisor" }), SEGREDO);
    const r = verifyAgentToken(token, SEGREDO);
    expect(r.ok && r.claims.papel).toBe("supervisor");
  });

  it("gives each token a distinct jti", () => {
    const a = mintAgentToken(colaborador(), SEGREDO).token;
    const b = mintAgentToken(colaborador(), SEGREDO).token;
    expect(a).not.toBe(b);
  });
});
