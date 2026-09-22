import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient, PREFERENCIA_POR_OMISSAO } from "./client.js";

/**
 * A preferência de fornecedor, pinada com um `fetch` falso.
 *
 * Vale um teste porque é invisível de outra maneira: um pedido sem
 * `provider` é aceite pelo OpenRouter na mesma, corre na mesma, e devolve a
 * mesma resposta. O que muda é **quanto custa** — cinco dos dez fornecedores
 * cobram 10 % a mais, e a cache de cada um é só dele, por isso espalhar os
 * pedidos paga a escrita da cache vezes sem conta em vez de a ler. Nada disso
 * dá erro. Sem este teste, uma regressão só aparecia na factura do mês
 * seguinte.
 */
function clienteFalso(opts: Partial<ConstructorParameters<typeof OpenRouterClient>[0]> = {}) {
  const corpos: any[] = [];
  const fetchFalso = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "x",
        choices: [{ message: { role: "assistant", content: "{}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const client = new OpenRouterClient({
    apiKey: "k",
    fetch: fetchFalso as unknown as typeof fetch,
    ...opts,
  });
  return { client, corpos };
}

const PEDIDO = { model: "anthropic/claude-sonnet-5", messages: [] };

describe("preferência de fornecedor", () => {
  it("por omissão vai a Anthropic, com rede de segurança", async () => {
    const { client, corpos } = clienteFalso();
    await client.chatCompletion({ ...PEDIDO });
    expect(corpos[0].provider).toEqual(PREFERENCIA_POR_OMISSAO);
    expect(corpos[0].provider.order).toEqual(["anthropic"]);
  });

  it("os fallbacks ficam ligados — uma corrida cara é melhor do que nenhuma", async () => {
    // Fixar sem rede faria uma indisponibilidade da Anthropic parar a análise
    // do dia inteiro. Já tivemos dois dias parados sem ninguém dar por isso.
    expect(PREFERENCIA_POR_OMISSAO.allow_fallbacks).toBe(true);
  });

  it("uma escolha explícita do chamador ganha sempre", async () => {
    const { client, corpos } = clienteFalso();
    await client.chatCompletion({ ...PEDIDO, provider: { order: ["openai"] } });
    expect(corpos[0].provider).toEqual({ order: ["openai"] });
  });

  it("`defaultProvider: null` desliga a preferência por completo", async () => {
    // A saída de emergência: sem ela, contornar este ficheiro obrigaria a
    // editá-lo, e uma biblioteca que não se consegue contornar é uma que
    // alguém acaba por copiar.
    const { client, corpos } = clienteFalso({ defaultProvider: null });
    await client.chatCompletion({ ...PEDIDO });
    expect(corpos[0].provider).toBeUndefined();
  });

  it("o cliente pode ter a sua própria preferência", async () => {
    const { client, corpos } = clienteFalso({ defaultProvider: { order: ["google"] } });
    await client.chatCompletion({ ...PEDIDO });
    expect(corpos[0].provider).toEqual({ order: ["google"] });
  });
});
