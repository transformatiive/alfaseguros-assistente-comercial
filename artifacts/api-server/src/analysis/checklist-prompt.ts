import type { GroupedConversation } from "../grouping/conversations.js";
import { buildConversationUserMessage } from "./prompts.js";

/**
 * A checklist item as fed to the LLM. `id` is the DB `checklist_items.id` — the
 * model must echo it back so we can map results to points unambiguously.
 */
export interface ChecklistItemForPrompt {
  id: number;
  categoria: string;
  validacao: string;
  texto: string;
  condicional: boolean;
  /** When conditional, the condition under which the point applies. */
  condicaoDescricao: string | null;
}

const SYSTEM_HEADER = `És um avaliador de cumprimento de guião comercial de uma corretora de seguros portuguesa (Alfaseguros), equipa Vida (seguro de vida de crédito habitação). A tua função é ler a transcrição/resumo de uma chamada e decidir, para CADA ponto do guião indicado, se foi cumprido.

Falas e escreves **apenas** em Português europeu. Nunca Brasileiro, nunca Inglês (exceto inevitáveis como "follow-up").`;

const ESTADO_RULES = `Para cada ponto, atribui exactamente UM estado:

- "cumprido" — há evidência clara na transcrição de que o operador fez o que o ponto descreve.
- "nao_cumprido" — o ponto era aplicável e há evidência de que NÃO foi feito (ou foi feito de forma claramente incompleta).
- "nao_aplicavel" — o ponto é CONDICIONAL e a sua condição não ocorreu nesta chamada. Usa SÓ para pontos marcados como condicionais. Exemplo: um ponto que só se aplica "se o cliente recusou avançar" quando o cliente, de facto, aceitou.
- "indeterminado" — não é possível decidir a partir desta transcrição (resumo demasiado curto, sem sinal sobre este ponto). Na dúvida entre nao_cumprido e indeterminado, escolhe **indeterminado** — nunca penalizes o operador por falta de informação.

Regras:
- NÃO inventes. Se o resumo não menciona o ponto e não é razoável inferir, é "indeterminado", não "nao_cumprido".
- "nao_aplicavel" é exclusivo de pontos condicionais cuja condição não ocorreu. Um ponto não-condicional nunca é "nao_aplicavel".
- "evidencia" deve ser uma citação curta ou justificação factual (1 frase). Em terceira pessoa. Vazia "" se indeterminado.
- Devolve um resultado para CADA ponto listado, usando o "id" exacto indicado.`;

function buildSchemaDescription(): string {
  return `Devolve **apenas** JSON válido (sem markdown) com esta estrutura:

{
  "faseDetectada": "primeiro_contacto" | "follow_up" | "proposta" | "pos_venda",   // a fase do guião a que esta chamada melhor corresponde
  "resultados": [
    { "itemId": number, "estado": "cumprido"|"nao_cumprido"|"nao_aplicavel"|"indeterminado", "evidencia": string }
  ]
}

Inclui um objecto em "resultados" para cada ponto do guião abaixo, com o "itemId" exacto.`;
}

export function buildChecklistSystemPrompt(): string {
  return [
    SYSTEM_HEADER,
    "",
    "## Estados possíveis e regras de decisão",
    "",
    ESTADO_RULES,
    "",
    "## Formato de saída",
    "",
    buildSchemaDescription(),
  ].join("\n");
}

/** Render the checklist items, grouped by category, with their ids. */
export function formatChecklistItems(items: ChecklistItemForPrompt[]): string {
  const byCategory = new Map<string, ChecklistItemForPrompt[]>();
  for (const it of items) {
    const list = byCategory.get(it.categoria) ?? [];
    list.push(it);
    byCategory.set(it.categoria, list);
  }

  const lines: string[] = ["# Guião a avaliar", ""];
  for (const [categoria, list] of byCategory) {
    lines.push(`## ${categoria}`);
    for (const it of list) {
      const cond = it.condicional
        ? ` [CONDICIONAL — só aplicável se: ${it.condicaoDescricao ?? "(condição não especificada)"}]`
        : "";
      lines.push(`- id=${it.id} · ${it.validacao}: ${it.texto}${cond}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function buildChecklistUserMessage(
  conv: GroupedConversation,
  items: ChecklistItemForPrompt[],
): string {
  return [
    buildConversationUserMessage(conv),
    "",
    "---",
    "",
    formatChecklistItems(items),
  ].join("\n");
}
