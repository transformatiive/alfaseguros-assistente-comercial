import { z } from "zod";
import type { OpenRouterClient } from "@workspace/openrouter";
import { tipoGuiao } from "./catalogo.js";
import { ordenarPontos, type Agregado } from "./agregar.js";

/**
 * "Destaques da IA": 4 a 5 frases curtas sobre os números do período, para
 * quem não tem tempo de ler todos os indicadores. Pedido do Nuno (21/10/2026),
 * não da Soraia.
 *
 * O modelo só recebe números já calculados (nunca transcrições), por isso é
 * barato e não pode inventar chamadas. Cada destaque pode apontar para um ponto
 * do guião, que o painel abre com um clique.
 */

export const destaqueSchema = z.object({
  etiqueta: z.enum(["O que mudou", "Onde se perdem vendas", "Objeções", "Coaching", "A ouvir"]).catch("Coaching"),
  titulo: z.string(),
  texto: z.string(),
  item: z.string().nullish().catch(null),
});

export const destaquesSchema = z.object({
  destaques: z.array(destaqueSchema).max(6),
  resumoPorTipo: z.record(z.string(), z.string()).catch({}),
});

export type Destaques = z.infer<typeof destaquesSchema>;

export interface ContextoDestaques {
  de: string;
  ate: string;
  atual: Agregado;
  anterior: Agregado;
  desfechos: Record<string, number>;
  /** Objeção → [chamadas com a objeção, das quais avançaram para proposta]. */
  objecoes: Record<string, [number, number]>;
  /** Por ponto: [% proposta quando cumprido, % proposta quando não cumprido]. */
  impactoProposta: Array<{ item: string; validacao: string; comPct: number; semPct: number; n: number }>;
}

function numeros(ctx: ContextoDestaques): string {
  const anteriorPorItem = new Map(ctx.anterior.pontos.map((p) => [p.item, p.pct]));
  const pontos = ordenarPontos(ctx.atual.pontos, 3).map((p) => ({
    item: p.item,
    tipo: tipoGuiao(p.tipo).nome,
    ponto: p.validacao,
    pct: p.pct,
    pctAnterior: anteriorPorItem.get(p.item) ?? null,
    cumpriu: p.cumpriu,
    nao: p.nao,
    rever: p.rever,
  }));
  return JSON.stringify(
    {
      periodo: { de: ctx.de, ate: ctx.ate },
      kpis: ctx.atual.kpis,
      kpisPeriodoAnterior: ctx.anterior.kpis,
      porTipo: ctx.atual.porTipo,
      pontos,
      desfechos: ctx.desfechos,
      objecoes: ctx.objecoes,
      impactoProposta: ctx.impactoProposta,
    },
    null,
    1,
  );
}

const SISTEMA = `És o analista da supervisão comercial da Alfaseguros (campanha de seguro de vida do crédito habitação, um só colaborador: "Colaborador Vida"). Recebes os números de um período, já calculados a partir da análise das chamadas contra o guião de vendas.

Escreve em Português europeu, frases curtas, sem jargão. Só podes usar os números recebidos: não inventes valores, chamadas nem pessoas. Se um número tiver base pequena (menos de 5 chamadas), diz que é indicativo.

Devolve **apenas** JSON:
{
  "destaques": [  // 4 a 5, por esta ordem quando houver dados
    {"etiqueta": "O que mudou", "titulo": "...", "texto": "...", "item": "<id do ponto ou null>"},
    {"etiqueta": "Onde se perdem vendas", ...},   // usa impactoProposta: ponto cuja ausência mais reduz a passagem a proposta
    {"etiqueta": "Objeções", ...},                // as mais frequentes e qual acabou mais vezes em proposta
    {"etiqueta": "Coaching", ...},                // UM ponto a treinar esta semana, e porquê
    {"etiqueta": "A ouvir", ...}                  // pontos "a rever" e o que convém confirmar ouvindo
  ],
  "resumoPorTipo": {"primeiro": "...", "seguinte": "...", "proposta": "...", "pos_venda": "..."}  // 1 a 2 frases por tipo com chamadas; omite tipos sem chamadas
}
"titulo": até 12 palavras, com o número principal. "texto": 1 a 2 frases. "item": o id do ponto do guião a que o destaque se refere (para abrir as chamadas), ou null.`;

export async function gerarDestaques(
  ctx: ContextoDestaques,
  opts: { client: OpenRouterClient; modelo: string },
): Promise<{ ok: true; destaques: Destaques; custoUsd: number } | { ok: false; erro: string }> {
  try {
    const r = await opts.client.chatCompletion({
      model: opts.modelo,
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: numeros(ctx) },
      ],
    });
    const texto = r.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const v = destaquesSchema.safeParse(JSON.parse(texto));
    if (!v.success) return { ok: false, erro: v.error.message.slice(0, 300) };
    return { ok: true, destaques: v.data, custoUsd: r.cost.costUsd };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
