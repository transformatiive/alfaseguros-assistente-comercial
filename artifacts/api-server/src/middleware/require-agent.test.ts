import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import { mintAgentToken } from "../painel/token.js";
import type { Colaborador } from "@workspace/db";

const SEGREDO = "segredo-de-teste-suficientemente-longo";

// env() is cached per process, so it is mocked rather than poked via process.env.
vi.mock("../lib/env.js", () => ({
  env: () => ({ AGENT_TOKEN_SECRET: process.env.__TEST_SECRET }),
}));

const { requireAgent, requireSupervisor, agenteDe } = await import("./require-agent.js");

function colaborador(over: Partial<Colaborador> = {}): Colaborador {
  return {
    id: 7,
    nome: "Ana Silva",
    zid: "abc",
    crmUserId: null,
    ringoverUserId: "23275677",
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

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function reqWith(token?: string): Request {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as Request;
}

beforeEach(() => {
  process.env.__TEST_SECRET = SEGREDO;
});

describe("requireAgent", () => {
  it("lets a valid token through and attaches the claims", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    const req = reqWith(token);
    const next = vi.fn();
    requireAgent(req, fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(agenteDe(req).sub).toBe("7");
  });

  it("401s with no header, a junk token, or a wrong signature", () => {
    for (const token of [undefined, "lixo", mintAgentToken(colaborador(), "outro").token]) {
      const res = fakeRes();
      const next = vi.fn();
      requireAgent(reqWith(token), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    }
  });

  it("401s on an expired token", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO, new Date(Date.now() - 3_600_000));
    const res = fakeRes();
    const next = vi.fn();
    requireAgent(reqWith(token), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("403s a colaborador whose papel is nenhum", () => {
    const { token } = mintAgentToken(colaborador({ papel: "nenhum" }), SEGREDO);
    const res = fakeRes();
    const next = vi.fn();
    requireAgent(reqWith(token), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("503s, rather than letting anyone in, when the secret is missing", () => {
    const { token } = mintAgentToken(colaborador(), SEGREDO);
    delete process.env.__TEST_SECRET;
    const res = fakeRes();
    const next = vi.fn();
    requireAgent(reqWith(token), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });
});

describe("requireSupervisor", () => {
  it("403s an agente", () => {
    const { token } = mintAgentToken(colaborador({ papel: "agente" }), SEGREDO);
    const res = fakeRes();
    const next = vi.fn();
    requireSupervisor(reqWith(token), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("lets a supervisor through", () => {
    const { token } = mintAgentToken(colaborador({ papel: "supervisor" }), SEGREDO);
    const next = vi.fn();
    requireSupervisor(reqWith(token), fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
