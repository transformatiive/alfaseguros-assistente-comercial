import { z } from "zod";
import type { ChatMessage, CostBreakdown, OpenRouterClient } from "@workspace/openrouter";
import { GUIAO, LIMIAR_CONFIANCA, pontosDoTipo, TIPOS, type TipoChamada } from "./catalogo.js";

/**
 * Avaliação de uma chamada da campanha Vida contra o guião da Soraia.
 *
 * Uma só chamada ao modelo por gravação: decide se houve conversa útil, o tipo
 * de chamada, avalia os pontos desse tipo (com confiança) e escreve o resumo.
 * Nunca se confia na resposta crua: valida-se com Zod e reconcilia-se contra os
 * pontos do tipo escolhido.
 */

export const OBJECOES = ["banco", "tempo", "email", "preco", "saude", "outra"] as const;
export const DESFECHOS = ["proposta", "novo_contacto", "recusou", "outro"] as const;

const resultadoSchema = z.object({
  item: z.string(),
  estado: z.enum(["cumprido", "nao_cumprido", "nao_aplicavel"]).catch("nao_cumprido"),
  confianca: z.coerce.number().min(0).max(1).catch(0),
  evidencia: z.string().catch(""),
});

export const analiseSchema = z.object({
  conversa_util: z.boolean(),
  motivo_descarte: z.string().nullish().catch(null),
  tipo: z.enum(TIPOS as [TipoChamada, ...TipoChamada[]]).nullish().catch(null),
  resumo: z.string().catch(""),
  desfecho: z.enum(DESFECHOS).catch("outro"),
  objecoes: z.array(z.enum(OBJECOES).catch("outra")).catch([]),
  resultados: z.array(resultadoSchema).catch([]),
});

export type AnaliseBruta = z.infer<typeof analiseSchema>;

export interface ResultadoPonto {
  item: string;
  estado: "cumprido" | "nao_cumprido" | "nao_aplicavel";
  confianca: number;
  rever: boolean;
  evidencia: string;
}

export type Analise =
  | { util: false; motivo: string; resumo: string }
  | {
      util: true;
      tipo: TipoChamada;
      resumo: string;
      desfecho: (typeof DESFECHOS)[number];
      objecoes: string[];
      resultados: ResultadoPonto[];
    };

function guiaoEmTexto(): string {
  const linhas: string[] = [];
  for (const t of GUIAO) {
    linhas.push(`## Tipo "${t.id}" — ${t.nome}`, `Quando: ${t.descricao}`);
    for (const s of t.seccoes) {
      linhas.push(`### ${s.nome}${s.condicao ? ` [só se aplica se ${s.condicao}]` : ""}`);
      for (const pt of s.pontos) linhas.push(`- ${pt.id} · ${pt.validacao}: ${pt.pergunta}`);
    }
    linhas.push("");
  }
  return linhas.join("\n").trimEnd();
}

export function promptSistema(): string {
  return `És um avaliador de chamadas comerciais da Alfaseguros, corretora de seguros portuguesa. A campanha é de seguro de vida associado ao crédito habitação: o operador liga ao cliente para o ajudar a trocar o seguro do banco por um mais barato.

Recebes a transcrição automática de uma chamada gravada (dois canais: um é o operador da Alfaseguros, que se apresenta em nome da empresa; o outro é o cliente). A transcrição tem erros de reconhecimento de voz; lê pelo sentido.

Escreves **apenas** em Português europeu.

# O que tens de fazer

1. Decide se houve conversa útil. NÃO é útil: caixa de correio, ninguém atende, engano, o cliente só pede para ligarem mais tarde sem falar do seguro, chamada cortada antes de começar. Nesse caso "conversa_util": false, "motivo_descarte" numa frase, e "resultados": [].
2. Se for útil, escolhe o tipo de chamada ("tipo") entre: ${TIPOS.join(", ")}.
3. Avalia **todos os pontos desse tipo** (e só desse tipo), um a um:
   - "cumprido": há evidência de que o operador fez o que o ponto pede.
   - "nao_cumprido": o ponto aplicava-se e o operador não o fez.
   - "nao_aplicavel": o ponto não fazia sentido nesta chamada (ex.: secção de objeções quando o cliente não levantou nenhuma; "se disse que sim" quando disse que não). Não penaliza o operador.
   - "confianca": de 0 a 1, quão seguro estás. Abaixo de ${LIMIAR_CONFIANCA} o ponto vai para revisão humana — usa valores baixos quando a transcrição é confusa.
   - "evidencia": citação curta ou facto da chamada (1 frase, terceira pessoa).
4. "resumo": 2 a 3 frases sobre a chamada (situação do cliente, banco se for dito, o que ficou combinado). Sem nomes completos nem números de telefone.
5. "desfecho": "proposta" (avançou para proposta ou preencheu-a), "novo_contacto" (ficou marcado novo contacto), "recusou", ou "outro".
6. "objecoes": as objeções que o cliente levantou, entre ${OBJECOES.join(", ")}. Lista vazia se nenhuma.

# Guião

${guiaoEmTexto()}

# Formato de saída

Devolve **apenas** JSON válido, sem markdown:
{"conversa_util": boolean, "motivo_descarte": string|null, "tipo": string|null, "resumo": string, "desfecho": string, "objecoes": string[], "resultados": [{"item": string, "estado": string, "confianca": number, "evidencia": string}]}`;
}

/**
 * Garante um resultado por ponto do tipo: descarta ids inventados ou de outro
 * tipo, e marca como "A rever" (confiança 0) um ponto que o modelo omitiu.
 */
export function reconciliar(tipo: TipoChamada, brutos: AnaliseBruta["resultados"]): ResultadoPonto[] {
  const vistos = new Map<string, AnaliseBruta["resultados"][number]>();
  for (const r of brutos) if (!vistos.has(r.item)) vistos.set(r.item, r);
  return pontosDoTipo(tipo).map((pt) => {
    const r = vistos.get(pt.id);
    if (!r) return { item: pt.id, estado: "nao_cumprido", confianca: 0, rever: true, evidencia: "" };
    return {
      item: pt.id,
      estado: r.estado,
      confianca: r.confianca,
      rever: r.estado !== "nao_aplicavel" && r.confianca < LIMIAR_CONFIANCA,
      evidencia: r.evidencia,
    };
  });
}

export function interpretar(bruta: AnaliseBruta): Analise {
  if (!bruta.conversa_util || !bruta.tipo) {
    return { util: false, motivo: bruta.motivo_descarte ?? "Sem conversa útil", resumo: bruta.resumo };
  }
  return {
    util: true,
    tipo: bruta.tipo,
    resumo: bruta.resumo,
    desfecho: bruta.desfecho,
    objecoes: [...new Set(bruta.objecoes)],
    resultados: reconciliar(bruta.tipo, bruta.resultados),
  };
}

function limparJson(texto: string): string {
  return texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export type ResultadoAnalise =
  | { ok: true; analise: Analise; custo: CostBreakdown }
  | { ok: false; erro: string; custo: CostBreakdown | null };

export async function analisarChamada(
  conversa: string,
  opts: { client: OpenRouterClient; modelo: string },
): Promise<ResultadoAnalise> {
  const sistema: ChatMessage = {
    role: "system",
    content: [{ type: "text", text: promptSistema(), cache_control: { type: "ephemeral" } }],
  };
  let custo: CostBreakdown | null = null;
  try {
    const r = await opts.client.chatCompletion({
      model: opts.modelo,
      temperature: 0.1,
      max_tokens: 6000,
      response_format: { type: "json_object" },
      messages: [sistema, { role: "user", content: `# Transcrição\n\n${conversa}` }],
    });
    custo = r.cost;
    const json: unknown = JSON.parse(limparJson(r.text));
    const v = analiseSchema.safeParse(json);
    if (!v.success) return { ok: false, erro: `Resposta inválida: ${v.error.message.slice(0, 300)}`, custo };
    return { ok: true, analise: interpretar(v.data), custo };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message.slice(0, 500) : String(err), custo };
  }
}
