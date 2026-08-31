import {
  OpenRouterClient,
  type ChatMessage,
  type CostBreakdown,
} from "@workspace/openrouter";
import {
  operatorSummarySchema,
  type OperatorSummaryAnalysis,
} from "./schema.js";
import type { AnalyzedConversationRef } from "./summarizer.js";

export interface AgentBucket {
  agentId: string;
  agentName: string;
  /** Conversations where this agent was the *primary* (most-frequent) operator. */
  solo: AnalyzedConversationRef[];
  /** Conversations where this agent participated alongside others. */
  joint: AnalyzedConversationRef[];
}

export interface SummarizeAgentOptions {
  client: OpenRouterClient;
  model?: string;
  cacheSystemPrompt?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export type AgentSummarizeOutcome =
  | {
      ok: true;
      summary: OperatorSummaryAnalysis;
      cost: CostBreakdown;
      rawText: string;
    }
  | { ok: false; error: string; rawText: string; cost: CostBreakdown };

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

const SYSTEM = `És um supervisor sénior de uma corretora de seguros portuguesa (Alfaseguros), equipa Não Vida (360).

Recebes a lista das análises de conversas de UM operador específico para o dia, enriquecidas com tickets do Zoho Desk quando disponíveis. Produz coaching personalizado em Português europeu.

Devolve **apenas** JSON válido:

{
  "paragraphOverview": string,                    // 2-3 frases. Como foi o dia deste operador — equilibrado, sem julgamentos.
  "strengths": string[],                          // 2-4 itens. Comportamentos concretos que funcionaram bem — cita momentos específicos.
  "blindSpots": string[],                         // 2-4 itens. Áreas de crescimento ainda não consolidadas — formuladas como oportunidades, nunca como falhas de carácter.
  "closingRateObservations": string,              // 1-2 frases sobre comportamento de fecho (oportunidades captadas vs. por desenvolver)
  "coachingRecommendations": string[]             // 2-4 ações concretas para a próxima semana, em terceira pessoa pelo nome próprio (ex: "A Marina pode experimentar...")
}

Distinguir entre conversas SOLO (este operador foi o principal) e JOINT (participou junto com outros). O coaching deve ser justo: erros em chamadas joint não são totalmente atribuíveis a este operador.

Quando existirem tickets Zoho associados a uma conversa, usa-os para contextualizar: o cliente já tinha contactado por outro canal? O ticket foi resolvido? Há padrão de recorrência?

REGRA DE TOM — OBRIGATÓRIA:
O objetivo é que o operador leia o feedback e sinta que tem um aliado, não um juiz.
- Descreve comportamentos e padrões observados — nunca intenções, atitudes ou traços de carácter.
- Nos blindSpots e coachingRecommendations, o foco é sempre "o que pode ser desenvolvido", nunca "o que está errado na pessoa".
- Usa framing de crescimento: "X tem uma oportunidade de...", "Uma área a desenvolver é...", "X beneficiaria de...", "Nas próximas chamadas, X pode experimentar..."
- PROIBIDO: "parece não estar a ver", "não interiorizou", "não reconhece", "ignora", "falha sistematicamente", "não percebe". Estas expressões soam acusatórias.
- PROIBIDO: linguagem que atribua intenção negativa ou negligência ao operador.
- Quando houver um padrão problemático, descreve o padrão e o seu impacto — não o operador como causa do problema. Ex: em vez de "A Andreia não agenda follow-ups" → "As conversas têm terminado sem próximo passo datado, o que reduz a probabilidade de conversão."

REGRA ABSOLUTA — PESSOA GRAMATICAL (aplica-se a TODOS os campos do output JSON):
Usa SEMPRE a terceira pessoa, referindo o operador pelo nome próprio com artigo.
EXEMPLOS CORRETOS: "A Marina fez bem em…", "O João fechou sem combinar o próximo passo.", "A Ana identificou a necessidade do cliente."
PROIBIDO — segunda pessoa (-ste/-stes, tu): "fizeste", "saíste", "deixaste", "confirmaste", "encerraste", "identificaste" — qualquer verbo neste padrão.
PROIBIDO — primeira pessoa do supervisor: "percebo", "vejo", "noto", "entendo", "reconheço".
PROIBIDO — possessivos de segunda pessoa: "teu", "tua", "o teu", "a tua", "culpa tua".
PROIBIDO — vocativo + tu: "Marina, fizeste…", "João, encerraste…" — mesmo com o nome, se o verbo for em tu é PROIBIDO.
CORRETO para o mesmo caso: "A Marina fez…", "O João encerrou…"

NEGRITO: Nos campos de texto livre (paragraphOverview, strengths, blindSpots, closingRateObservations, coachingRecommendations), usa a sintaxe markdown '**texto em negrito**' para destacar: o comportamento concreto mais relevante, o procedimento cumprido ou falhado, e o impacto identificado. Máximo 2-3 negritos por item — não negrites tudo.

EU-PT. Sem brasileirismos.`;

function describeConv(c: AnalyzedConversationRef): string {
  const a = c.analysis;
  const lines = [
    `- Conversa ${c.rowId} | Cliente ${c.customerPhone} | ${a.categoria} ${a.produto} | qualidade ${a.qualidadeGlobal}/5 | risco ${a.riscoPerdaLead}`,
    `  Narrativa: ${a.narrativaConversa}`,
    a.desviosProcedimento.length > 0
      ? `  Desvios: ${a.desviosProcedimento
          .map((d) => `${d.severidade}/${d.titulo}`)
          .join(", ")}`
      : "  Desvios: nenhum",
    a.pontosPositivos.length > 0
      ? `  Positivos: ${a.pontosPositivos.join("; ")}`
      : "  Positivos: (nada destacado)",
    `  Feedback existente: ${a.feedbackSupervisor}`,
  ];
  if (c.relatedTickets && c.relatedTickets.length > 0) {
    for (const t of c.relatedTickets) {
      lines.push(
        `  Ticket Zoho #${t.ticketNumber ?? "?"} "${t.subject ?? "(sem assunto)"}" [${t.status ?? "?"}${t.closedTime ? " — fechado" : ""}]`,
      );
      if (t.comments && t.comments.length > 0) {
        for (const cm of t.comments) {
          const ts = cm.commentedTime
            ? new Date(cm.commentedTime).toISOString().slice(0, 16).replace("T", " ")
            : "?";
          const who = cm.authorName ?? (cm.authorType === "END_USER" ? "Cliente" : "Agente");
          const type = cm.authorType === "END_USER" ? "Msg" : "Nota interna";
          const text = cm.content ? ` "${cm.content.trim().slice(0, 150)}"` : "";
          lines.push(`    [${ts}] ${type} — ${who}:${text}`);
        }
      }
    }
  }
  return lines.join("\n");
}

export async function generateAgentSummary(
  bucket: AgentBucket,
  date: string,
  opts: SummarizeAgentOptions,
): Promise<AgentSummarizeOutcome> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cache = opts.cacheSystemPrompt ?? true;

  const userText = [
    `# Coaching diário — ${bucket.agentName} — ${date}`,
    `Total: ${bucket.solo.length} solo + ${bucket.joint.length} joint = ${bucket.solo.length + bucket.joint.length} conversas`,
    "",
    "## Conversas solo (operador principal)",
    bucket.solo.length > 0 ? bucket.solo.map(describeConv).join("\n\n") : "(nenhuma)",
    "",
    "## Conversas joint (com outros operadores)",
    bucket.joint.length > 0 ? bucket.joint.map(describeConv).join("\n\n") : "(nenhuma)",
    "",
    `Produz o coaching de ${bucket.agentName} segundo o esquema. Refere-te ao operador sempre na terceira pessoa pelo nome próprio (ex: "${bucket.agentName} pode melhorar..."). Nunca usar "tu" ou segunda pessoa.`,
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
    max_tokens: opts.maxTokens ?? 12000,
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

  const validated = operatorSummarySchema.safeParse(parsed);
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

/**
 * Group analyzed conversations by primary agent. Conversations where the agent
 * was primary go in `solo`; ones where they participated alongside others go
 * in `joint`. Conversations without any agent attribution are dropped.
 */
export function bucketByAgent(
  refs: Array<AnalyzedConversationRef & { agentId: string | null; agentsInvolved: { id: string; name: string }[] }>,
): AgentBucket[] {
  const buckets = new Map<string, AgentBucket>();

  for (const ref of refs) {
    const primary = ref.agentId;
    for (const agent of ref.agentsInvolved) {
      let bucket = buckets.get(agent.id);
      if (!bucket) {
        bucket = { agentId: agent.id, agentName: agent.name || `(user_id ${agent.id})`, solo: [], joint: [] };
        buckets.set(agent.id, bucket);
      }
      if (agent.id === primary && ref.agentsInvolved.length === 1) {
        bucket.solo.push(ref);
      } else if (agent.id === primary) {
        // primary on a joint call — count as solo for them, joint for others
        bucket.solo.push(ref);
      } else {
        bucket.joint.push(ref);
      }
    }
  }

  return [...buckets.values()].sort((a, b) =>
    b.solo.length + b.joint.length - (a.solo.length + a.joint.length),
  );
}
