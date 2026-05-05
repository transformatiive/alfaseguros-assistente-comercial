import {
  OpenRouterClient,
  type ChatMessage,
  type CostBreakdown,
} from "@workspace/openrouter";
import {
  dailySummarySchema,
  type ConversationAnalysis,
  type DailySummaryAnalysis,
} from "./schema.js";

export interface AnalyzedConversationRef {
  rowId: number;
  customerPhone: string;
  agentName: string | null;
  legCount: number;
  durationSec: number;
  analysis: ConversationAnalysis;
}

export interface SummarizeOptions {
  client: OpenRouterClient;
  model?: string;
  cacheSystemPrompt?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export type SummarizeOutcome =
  | { ok: true; summary: DailySummaryAnalysis; cost: CostBreakdown; rawText: string }
  | { ok: false; error: string; rawText: string; cost: CostBreakdown };

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

const SYSTEM = `És um supervisor sénior de uma corretora de seguros portuguesa (Alfaseguros), equipa Não Vida (360).

Recebes a lista das análises de todas as conversas telefónicas analisadas para o dia. A tua tarefa é produzir um resumo executivo diário, em Português europeu, dirigido ao CEO (Rui).

O resumo tem cinco secções estruturadas + um abstract. Cada secção segue esta ordem:
1. \`bullets\` (3-5 temas/padrões observados — frases curtas, concisas, que nomeiam o tema; ex: "Fecho de cotações TVDE com objeção de preço")
2. \`paragraph\` (1-3 frases com exemplos concretos que ilustram esses temas, com nomes de operadores e situações específicas; ex: "A Andreia C. fechou 3 cotações TVDE superando objeções de preço nas chamadas da tarde.")

Sê específico nos exemplos: cita nomes, números e momentos concretos.

Devolve **apenas** JSON válido (sem markdown, sem comentários):

{
  "executiveSummary": string,                                  // 1-2 frases. O headline do dia.
  "workingWell":              { "paragraph": string, "bullets": string[] },
  "toImprove":                { "paragraph": string, "bullets": string[] },
  "risks":                    { "paragraph": string, "bullets": string[] },
  "closingRateRecommendations": { "paragraph": string, "bullets": string[] },  // SECÇÃO MAIS IMPORTANTE para o Rui
  "automationOpportunities": {
    "paragraph": string,
    "items": [
      {
        "pattern": string,                          // descrição do padrão repetitivo
        "conversationCountEstimate": number,        // quantas conversas hoje encaixam neste padrão
        "channel": string,                          // ex: "Telefone", "Email", "Self-service"
        "feasibility": "alta" | "media" | "baixa",  // viabilidade técnica e comercial
        "notes": string                              // 1 frase: porquê e o que fazer a seguir
      }
    ]
  }
}

EU-PT sempre. Tom coaching (a ferramenta é para ajudar a equipa a fechar mais, não para vigiar). Cita conversas e operadores específicos sempre que fizer sentido.`;

function summarizeConversation(c: AnalyzedConversationRef): string {
  const a = c.analysis;
  const desvios = a.desviosProcedimento.length > 0
    ? a.desviosProcedimento
        .map((d) => `${d.severidade.toUpperCase()}: ${d.titulo}${d.detalhe ? ` — ${d.detalhe}` : ""}`)
        .join(" | ")
    : "(sem desvios)";
  return [
    `## Conversa ${c.rowId} — Cliente ${c.customerPhone} — Operador ${c.agentName ?? "(?)"} — ${c.legCount} leg(s) — ${Math.round(c.durationSec / 60)}min`,
    `Categoria: ${a.categoria} | Produto: ${a.produto} | Qualidade: ${a.qualidadeGlobal}/5 | Risco: ${a.riscoPerdaLead} | FollowUp: ${a.followUpNecessario ? "sim" : "não"}${a.followUpNecessario && a.followUpDescricao ? ` (${a.followUpDescricao})` : ""}`,
    `Arco: ${a.arcoConversa} — Sentimento: ${a.sentimentoClienteEvolucao}`,
    `Narrativa: ${a.narrativaConversa}`,
    `Desvios: ${desvios}`,
    `Pontos positivos: ${a.pontosPositivos.length > 0 ? a.pontosPositivos.join(" | ") : "(nenhum destacado)"}`,
    `Tags: ${a.tags.join(", ") || "(nenhuma)"}`,
  ].join("\n");
}

export async function generateDailySummary(
  conversations: AnalyzedConversationRef[],
  date: string,
  opts: SummarizeOptions,
): Promise<SummarizeOutcome> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;

  const userText = [
    `# Análises de conversas — ${date}`,
    `Total de conversas analisadas: ${conversations.length}`,
    "",
    ...conversations.map(summarizeConversation),
    "",
    "Produz o resumo executivo do dia segundo o esquema definido.",
  ].join("\n");

  const systemMessage: ChatMessage = cache
    ? {
        role: "system",
        content: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      }
    : { role: "system", content: SYSTEM };

  const result = await opts.client.chatCompletion({
    model,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4000,
    response_format: { type: "json_object" },
    messages: [systemMessage, { role: "user", content: userText }],
  });

  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      error: `Resposta do LLM não é JSON válido: ${(err as Error).message}. Raw: ${cleaned.slice(0, 300)}`,
      rawText: result.text,
      cost: result.cost,
    };
  }

  const validated = dailySummarySchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Resposta falhou validação Zod: ${validated.error.message}`,
      rawText: result.text,
      cost: result.cost,
    };
  }

  return { ok: true, summary: validated.data, cost: result.cost, rawText: result.text };
}
