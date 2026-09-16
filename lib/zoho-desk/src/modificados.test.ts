import { describe, expect, it, vi } from "vitest";
import { ZohoDeskClient } from "./client.js";
import { ZohoAuth } from "./auth.js";

/**
 * A paginação de `listTicketsModifiedSince`, pinada com um `fetch` falso.
 *
 * Vale um teste porque a paragem é a parte que custa dinheiro: parar cedo
 * demais perde respostas de agentes — que é o bug que esta função existe para
 * corrigir — e parar tarde demais percorre o histórico inteiro do portal a
 * cada quinze minutos.
 */

function clienteComPaginas(paginas: Array<Array<{ id: string; modifiedTime: string | null }>>) {
  const chamadas: URL[] = [];
  const fetchFalso = vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    chamadas.push(u);
    const from = Number(u.searchParams.get("from") ?? "0");
    const pagina = paginas[from / 100] ?? [];
    return new Response(JSON.stringify({ data: pagina }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const auth = {
    getAccessToken: async () => "token-falso",
    invalidate: () => {},
  } as unknown as ZohoAuth;

  const client = new ZohoDeskClient({
    auth,
    orgId: "683863304",
    fetch: fetchFalso as unknown as typeof fetch,
  });

  return { client, chamadas };
}

/** 100 tickets todos com a mesma data — uma página cheia. */
function paginaCheia(quando: string): Array<{ id: string; modifiedTime: string }> {
  return Array.from({ length: 100 }, (_, i) => ({ id: `${quando}-${i}`, modifiedTime: quando }));
}

describe("listTicketsModifiedSince", () => {
  it("pede ordenado por -modifiedTime", async () => {
    const { client, chamadas } = clienteComPaginas([[]]);
    await client.listTicketsModifiedSince({ modifiedTimeFrom: "2026-09-16T08:00:00Z" });
    expect(chamadas[0].searchParams.get("sortBy")).toBe("-modifiedTime");
  });

  it("pára na primeira página quando ela já sai da janela", async () => {
    const { client, chamadas } = clienteComPaginas([
      [
        { id: "a", modifiedTime: "2026-09-16T10:00:00Z" },
        { id: "b", modifiedTime: "2026-09-16T07:00:00Z" }, // anterior à janela
        { id: "c", modifiedTime: "2026-09-16T06:00:00Z" },
      ],
    ]);
    const r = await client.listTicketsModifiedSince({
      modifiedTimeFrom: "2026-09-16T08:00:00Z",
    });
    expect(r.map((t) => t.id)).toEqual(["a"]);
    expect(chamadas).toHaveLength(1);
  });

  it("avança de página enquanto a janela não acabar", async () => {
    const { client, chamadas } = clienteComPaginas([
      paginaCheia("2026-09-16T10:00:00Z"),
      [{ id: "velho", modifiedTime: "2026-09-16T06:00:00Z" }],
    ]);
    const r = await client.listTicketsModifiedSince({
      modifiedTimeFrom: "2026-09-16T08:00:00Z",
    });
    expect(r).toHaveLength(100);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].searchParams.get("from")).toBe("100");
  });

  it("um ticket sem data é saltado, e não trava a paginação", async () => {
    // Um dado em falta não é um sinal de que se chegou ao fim da janela.
    // Tratá-lo como fim faria a sincronização parar a meio sem dizer nada.
    const { client } = clienteComPaginas([
      [
        { id: "sem-data", modifiedTime: null },
        { id: "bom", modifiedTime: "2026-09-16T10:00:00Z" },
        { id: "velho", modifiedTime: "2026-09-16T06:00:00Z" },
      ],
    ]);
    const r = await client.listTicketsModifiedSince({
      modifiedTimeFrom: "2026-09-16T08:00:00Z",
    });
    expect(r.map((t) => t.id)).toEqual(["bom"]);
  });

  it("respeita o tecto de páginas em vez de percorrer o portal todo", async () => {
    const { client, chamadas } = clienteComPaginas(
      Array.from({ length: 10 }, () => paginaCheia("2026-09-16T10:00:00Z")),
    );
    await client.listTicketsModifiedSince({
      modifiedTimeFrom: "2026-09-16T08:00:00Z",
      maxPages: 3,
    });
    expect(chamadas).toHaveLength(3);
  });

  it("pára numa página vazia", async () => {
    const { client, chamadas } = clienteComPaginas([[]]);
    const r = await client.listTicketsModifiedSince({
      modifiedTimeFrom: "2026-09-16T08:00:00Z",
    });
    expect(r).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });
});
