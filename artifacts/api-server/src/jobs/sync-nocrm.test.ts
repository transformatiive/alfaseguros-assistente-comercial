import { describe, expect, it, vi } from "vitest";
import { NocrmErro, OrcamentoEsgotado } from "../nocrm/client.js";
import type { NocrmApiLead } from "../nocrm/types.js";
import { orcamentoDaCorrida, sincronizar, type DepsSync } from "./sync-nocrm.js";

const AGORA = new Date("2026-10-29T06:30:00Z");

function leadApi(id: number, updated: string, extra: Partial<NocrmApiLead> = {}): NocrmApiLead {
  return { id, title: `L${id}`, status: "todo", step: "Contactado", user_id: 1, created_at: "2026-10-01T10:00:00Z", updated_at: updated, ...extra };
}

/** Cliente falso: conta pedidos e pára quando o orçamento acaba, como o verdadeiro. */
function clienteFalso(opts: { orcamento: number; leads?: NocrmApiLead[]; falharNotasEm?: number; erroNotas?: Error }) {
  let restantes = opts.orcamento;
  let usados = 0;
  const gastar = (): void => {
    if (restantes <= 0) throw new OrcamentoEsgotado("acabou");
    restantes--;
    usados++;
  };
  const chamadas: string[] = [];
  return {
    chamadas,
    cliente: {
      get pedidosUsados() {
        return usados;
      },
      get pedidosRestantes() {
        return restantes;
      },
      listarUsers: vi.fn(async () => {
        gastar();
        return [{ id: 1, firstname: "Ana", lastname: null, email: "ana@x.pt" }];
      }),
      listarTags: vi.fn(async () => {
        gastar();
        return [{ name: "Site", category: "Origem da Lead" }];
      }),
      listarLeads: vi.fn(async (p: { atualizadasDesde?: string; estado?: string; offset?: number }) => {
        gastar();
        chamadas.push(`leads ${p.estado ?? ""} ${p.atualizadasDesde ?? ""} ${p.offset ?? 0}`);
        if (p.estado) return { leads: [], total: 0 };
        return { leads: (opts.leads ?? []).slice(p.offset ?? 0, (p.offset ?? 0) + 100), total: null };
      }),
      listarNotas: vi.fn(async (id: number) => {
        gastar();
        if (opts.falharNotasEm === id) throw opts.erroNotas ?? new Error("boom");
        return [{ id: id * 10, raw_content: "Duração da chamada : 00:01:00", created_at: "2026-10-28T10:00:00Z", user: { id: 1 } }];
      }),
      listarHistorico: vi.fn(async (id: number) => {
        gastar();
        return [{ id: id * 10 + 1, action_type: "step_changed", action_item: { name: "Contactado" }, created_at: "2026-10-27T10:00:00Z" }];
      }),
    },
  };
}

function repoFalso(fila: { id: number; atualizadaEm: Date }[] = []) {
  return {
    gravarUsers: vi.fn(async () => {}),
    ligarColaboradoresPorEmail: vi.fn(async () => 1),
    gravarTags: vi.fn(async () => {}),
    lerCategorias: vi.fn(async () => new Map<string, string | null>([["Site", "Origem da Lead"]])),
    gravarLeads: vi.fn(async () => {}),
    fotografarAgenda: vi.fn(async () => 3),
    leadsPorLerEventos: vi.fn(async (limite: number) => fila.slice(0, limite)),
    contarLeadsPorLerEventos: vi.fn(async () => 0),
    gravarEventosDaLead: vi.fn(async () => {}),
  };
}

describe("sincronizar", () => {
  it("primeira corrida: lê abertas, depois a janela inicial, e avança o cursor", async () => {
    const { cliente, chamadas } = clienteFalso({ orcamento: 100, leads: [leadApi(1, "2026-10-20T10:00:00Z"), leadApi(2, "2026-10-28T18:00:00Z")] });
    const r = repoFalso();
    const res = await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: r, cursor: null, agora: AGORA });

    expect(chamadas[0]).toMatch(/^leads todo/);
    expect(chamadas[1]).toMatch(/^leads standby/);
    expect(chamadas[2]).toContain("2026-08-30");
    expect(res.leads).toBe(2);
    expect(res.novoCursor?.toISOString()).toBe("2026-10-28T18:00:00.000Z");
    expect(res.agendaNova).toBe(3);
    expect(r.fotografarAgenda).toHaveBeenCalledWith("2026-10-29");
    expect(res.ok).toBe(true);
  });

  it("corridas seguintes pedem desde o cursor menos 5 minutos", async () => {
    const { cliente, chamadas } = clienteFalso({ orcamento: 100 });
    await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: repoFalso(), cursor: new Date("2026-10-28T18:00:00Z"), agora: AGORA });
    expect(chamadas).toEqual(["leads  2026-10-28T17:55:00.000Z 0"]);
  });

  it("pagina enquanto vêm páginas cheias", async () => {
    const muitas = Array.from({ length: 150 }, (_, i) => leadApi(i + 1, new Date(Date.UTC(2026, 9, 28, 0, i)).toISOString()));
    const { cliente, chamadas } = clienteFalso({ orcamento: 100, leads: muitas });
    const res = await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: repoFalso(), cursor: new Date("2026-10-27T00:00:00Z"), agora: AGORA });
    expect(chamadas).toHaveLength(2);
    expect(res.leads).toBe(150);
  });

  it("lê notas e histórico das leads em fila e grava o passo actual", async () => {
    const fila = [{ id: 7, atualizadaEm: new Date("2026-10-28T10:00:00Z") }];
    const { cliente } = clienteFalso({ orcamento: 100 });
    const r = repoFalso(fila);
    const res = await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: r, cursor: new Date("2026-10-28T00:00:00Z"), agora: AGORA });
    expect(res.leadsComEventos).toBe(1);
    expect(res.eventos).toBe(2);
    const [leadId, evs, passoDesde, lidosAte] = r.gravarEventosDaLead.mock.calls[0] as unknown as [number, { tipo: string }[], Date, Date];
    expect(leadId).toBe(7);
    expect(evs.map((e) => e.tipo).sort()).toEqual(["chamada", "passo"]);
    expect(passoDesde.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(lidosAte).toEqual(fila[0].atualizadaEm);
  });

  it("respeita o orçamento: nunca passa do limite e marca que esgotou", async () => {
    const fila = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, atualizadaEm: AGORA }));
    // 2 (users, tags) + 1 (leads) = 3; sobram 7 → 3 leads (6 pedidos) e pára.
    const { cliente } = clienteFalso({ orcamento: 10 });
    const r = repoFalso(fila);
    const res = await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: r, cursor: AGORA, agora: AGORA });
    expect(res.pedidos).toBeLessThanOrEqual(10);
    expect(res.leadsComEventos).toBe(3);
  });

  it("sem orçamento logo nas leads, não fotografa a agenda", async () => {
    const { cliente } = clienteFalso({ orcamento: 2 });
    const r = repoFalso();
    const res = await sincronizar({ cliente: cliente as unknown as DepsSync["cliente"], repo: r, cursor: AGORA, agora: AGORA });
    expect(res.ok).toBe(false);
    expect(res.orcamentoEsgotado).toBe(true);
    expect(r.fotografarAgenda).not.toHaveBeenCalled();
  });

  it("lead apagada (404) sai da fila; erro de chave (401) pára tudo", async () => {
    const fila = [1, 2, 3].map((id) => ({ id, atualizadaEm: AGORA }));
    const a = clienteFalso({ orcamento: 100, falharNotasEm: 1, erroNotas: new NocrmErro("x", 404) });
    const ra = repoFalso(fila);
    const resA = await sincronizar({ cliente: a.cliente as unknown as DepsSync["cliente"], repo: ra, cursor: AGORA, agora: AGORA });
    expect(ra.gravarEventosDaLead).toHaveBeenCalledTimes(3);
    expect(resA.leadsComEventos).toBe(2);

    const b = clienteFalso({ orcamento: 100, falharNotasEm: 1, erroNotas: new NocrmErro("x", 401) });
    const rb = repoFalso(fila);
    const resB = await sincronizar({ cliente: b.cliente as unknown as DepsSync["cliente"], repo: rb, cursor: AGORA, agora: AGORA });
    expect(rb.gravarEventosDaLead).not.toHaveBeenCalled();
    expect(resB.ok).toBe(false);
  });
});

describe("orcamentoDaCorrida", () => {
  it("divide o que sobra pelas corridas que faltam no dia (hora de Lisboa)", () => {
    expect(orcamentoDaCorrida(1500, new Date("2026-10-29T06:30:00Z"))).toBe(500);
    expect(orcamentoDaCorrida(1000, new Date("2026-10-29T13:00:00Z"))).toBe(500);
    expect(orcamentoDaCorrida(500, new Date("2026-10-29T18:00:00Z"))).toBe(500);
    // Verão: 11:30 UTC já são 12:30 em Lisboa.
    expect(orcamentoDaCorrida(1000, new Date("2026-07-01T11:30:00Z"))).toBe(500);
  });
});
