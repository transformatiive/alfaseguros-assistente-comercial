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

Recebes a lista das análises de conversas de UM operador específico para o dia. Produz coaching personalizado, em tom construtivo e específico (não policial), em Português europeu.

Devolve **apenas** JSON válido:

{
  "paragraphOverview": string,                    // 2-3 frases. Como foi o dia deste operador.
  "strengths": string[],                          // 2-4 itens. Cita momentos concretos.
  "blindSpots": string[],                         // 2-4 itens. O que o operador parece não estar a ver.
  "closingRateObservations": string,              // 1-2 frases sobre comportamento de fecho (oportunidades captadas vs. perdidas)
  "coachingRecommendations": string[]             // 2-4 ações concretas para a próxima semana, dirigidas pelo nome próprio
}

Distinguir entre conversas SOLO (este operador foi o principal) e JOINT (participou junto com outros). O coaching deve ser justo: erros em chamadas joint não são totalmente atribuíveis a este operador.

EU-PT. Sem brasileirismos.`;

function describeConv(c: AnalyzedConversationRef): string {
  const a = c.analysis;
  return [
    `- Cliente ${c.customerPhone} | ${a.categoria} ${a.produto} | qualidade ${a.qualidadeGlobal}/5 | risco ${a.riscoPerdaLead}`,
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
  ].join("\n");
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
    `Produz o coaching de ${bucket.agentName} segundo o esquema. Dirige-te ao operador pelo nome próprio.`,
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
    max_tokens: opts.maxTokens ?? 2500,
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
