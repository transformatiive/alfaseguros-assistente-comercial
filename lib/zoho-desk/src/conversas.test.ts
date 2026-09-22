import { describe, expect, it, vi } from "vitest";
import { normalizarConversa } from "./types.js";
import { ZohoDeskClient } from "./client.js";
import type { ZohoAuth } from "./auth.js";

/**
 * A normalização das duas formas que o Desk devolve em `/conversations`.
 *
 * Vale testes porque é a peça que corrige o erro de fundo do painel: durante
 * meses lemos só `/comments`, e **todas as respostas enviadas aos clientes
 * eram invisíveis**. Os exemplos abaixo são os da documentação oficial da
 * Zoho, com os campos que nos interessam.
 */

const THREAD_SAIDA = {
  id: "1892000001080014",
  type: "thread",
  channel: "EMAIL",
  direction: "out",
  createdTime: "2016-07-07T10:12:04.177Z",
  summary: "Seguem as simulações que pediu.",
  visibility: "public",
  isDescriptionThread: false,
  author: { name: "Tiago Paiva", type: "AGENT", email: "tiago@alfaseguros.pt" },
};

const THREAD_ENTRADA = {
  id: "1892000001080004",
  type: "thread",
  channel: "EMAIL",
  direction: "in",
  createdTime: "2016-07-07T10:02:04.663Z",
  summary: "Alguma novidade?",
  author: { firstName: "Maria", lastName: "José", type: "END_USER", email: "mj@exemplo.pt" },
};

const COMENTARIO = {
  id: "1892000000886025",
  type: "comment",
  commentedTime: "2016-02-16T09:21:58.000Z",
  isPublic: true,
  content: "Cliente pediu para ligar depois das 18h.",
  commenter: { firstName: "Tiago", lastName: "Paiva", type: "AGENT", roleName: "Agent" },
};

describe("normalizarConversa", () => {
  it("um email enviado pelo agente é a resposta que faltava ver", () => {
    const c = normalizarConversa(THREAD_SAIDA);
    expect(c).toMatchObject({
      tipo: "thread",
      quando: "2016-07-07T10:12:04.177Z",
      direcao: "out",
      autorTipo: "AGENT",
      autorNome: "Tiago Paiva",
      texto: "Seguem as simulações que pediu.",
    });
  });

  it("um email recebido fica marcado como entrada", () => {
    // O painel precisa da distinção: um email que entrou não é trabalho nosso.
    const c = normalizarConversa(THREAD_ENTRADA);
    expect(c.direcao).toBe("in");
    expect(c.autorTipo).toBe("END_USER");
    expect(c.autorNome).toBe("Maria José");
  });

  it("uma nota interna continua a ler-se como sempre se leu", () => {
    const c = normalizarConversa(COMENTARIO);
    expect(c).toMatchObject({
      tipo: "comment",
      quando: "2016-02-16T09:21:58.000Z",
      direcao: null,
      autorTipo: "AGENT",
      autorNome: "Tiago Paiva",
      texto: "Cliente pediu para ligar depois das 18h.",
    });
  });

  it("sem `type`, a presença de `commenter` desempata", () => {
    // A documentação não promete que o `type` venha sempre. `commenter` é o
    // campo que só o comentário tem, por isso serve de desempate.
    const { type, ...semTipo } = COMENTARIO;
    expect(normalizarConversa(semTipo).tipo).toBe("comment");
    const { type: _t, ...threadSemTipo } = THREAD_SAIDA;
    expect(normalizarConversa(threadSemTipo).tipo).toBe("thread");
  });

  it("um autor sem nome composto não inventa um nome", () => {
    const c = normalizarConversa({ id: "x", type: "thread", author: { type: "AGENT" } });
    expect(c.autorNome).toBeNull();
    expect(c.texto).toBeNull();
    expect(c.quando).toBeNull();
  });
});

describe("listTicketConversations", () => {
  function clienteCom(paginas: unknown[][]) {
    const chamadas: URL[] = [];
    const fetchFalso = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      chamadas.push(u);
      const pagina = paginas[Number(u.searchParams.get("from") ?? "0") / 100] ?? [];
      return new Response(JSON.stringify({ data: pagina }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new ZohoDeskClient({
      auth: { getAccessToken: async () => "t", invalidate: () => {} } as unknown as ZohoAuth,
      orgId: "683863304",
      fetch: fetchFalso as unknown as typeof fetch,
    });
    return { client, chamadas };
  }

  it("vai ao endpoint das conversas, não ao dos comentários", async () => {
    // A troca é o ponto todo desta mudança. `/comments` devolve metade.
    const { client, chamadas } = clienteCom([[]]);
    await client.listTicketConversations("176592");
    expect(chamadas[0].pathname).toContain("/tickets/176592/conversations");
  });

  it("devolve threads e comentários misturados, já normalizados", async () => {
    const { client } = clienteCom([[THREAD_ENTRADA, THREAD_SAIDA, COMENTARIO]]);
    const r = await client.listTicketConversations("1");
    expect(r.map((c) => c.tipo)).toEqual(["thread", "thread", "comment"]);
    expect(r.filter((c) => c.autorTipo === "AGENT" && c.direcao !== "in")).toHaveLength(2);
  });

  it("pagina enquanto a página vier cheia", async () => {
    const cheia = Array.from({ length: 100 }, (_, i) => ({ ...COMENTARIO, id: `c${i}` }));
    const { client, chamadas } = clienteCom([cheia, [COMENTARIO]]);
    const r = await client.listTicketConversations("1");
    expect(r).toHaveLength(101);
    expect(chamadas[1].searchParams.get("from")).toBe("100");
  });

  it("pára numa página vazia", async () => {
    const { client, chamadas } = clienteCom([[]]);
    expect(await client.listTicketConversations("1")).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });
});
