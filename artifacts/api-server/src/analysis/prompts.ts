import { PROCEDURES_TEXT } from "../procedures/procedures.js";
import type { GroupedConversation } from "../grouping/conversations.js";

const SCHEMA_DESCRIPTION = `
Devolve **apenas** JSON válido (sem markdown, sem comentários) com a seguinte estrutura:

{
  "categoria": string,                       // Cotação | Renovação | Sinistro | Informação | Pós-venda | Outro
  "produto": string,                         // TVDE | Auto | Multirriscos | Condomínio | Saúde | Empresas | Outro
  "narrativaConversa": string,               // 3-6 frases. A história completa: o que o cliente queria, o que aconteceu, em que ponto ficou.
  "arcoConversa": string,                    // ex: "Frio→Quente", "Estagnado", "Quente→Esfriou", "Direto ao Fecho"
  "sentimentoClienteEvolucao": string,       // 1-2 frases sobre como o sentimento do cliente evoluiu ao longo das chamadas
  "qualidadeGlobal": number,                 // inteiro 1-5 (1=má, 5=excelente)
  "continuidade": string,                    // se a conversa for multi-leg: como ficou a continuidade entre legs/operadores. Vazio "" se single-leg.
  "desviosProcedimento": [
    {
      "severidade": "alta" | "media" | "baixa",
      "titulo": string,                      // label curto, ex: "Sem confirmação de identidade"
      "detalhe": string,                     // o que faltou e porquê é relevante
      "chamadaEspecifica": string | null     // ex: "16:06 (chamada 1)" se aplicável
    }
  ],
  "pontosPositivos": string[],               // 2-4 boas práticas observadas; cita momentos concretos
  "feedbackSupervisor": string,              // 2-4 frases em terceira pessoa, referindo o operador pelo nome próprio (ex: "A Marina fez bem em... / A Marina pode melhorar..."). Nunca usar "tu" ou segunda pessoa.
  "sugestaoEspecialista": string,            // 1-3 frases com sugestão de cross-sell ou conhecimento técnico relevante
  "followUpNecessario": boolean,             // true se a conversa precisar de seguimento concreto
  "followUpDescricao": string,               // o que fazer e quando ("ligar até quinta-feira para confirmar..."). Vazio "" se followUpNecessario=false.
  "riscoPerdaLead": "baixo" | "medio" | "alto",
  "tags": string[]                           // 1-5 etiquetas curtas em maiúsculas, ex: ["TVDE", "OBJEÇÃO PREÇO", "PROMESSA RETORNO"]
}

Regras de qualidade:
- Sê específico. Cita nomes de operadores, valores, momentos concretos.
- Tom coaching: a ferramenta serve para ajudar o operador a fechar mais, não para vigiar. Mas não suaviza falhas reais.
- EU-PT (Português europeu) sempre. Sem brasileirismos.
- Se faltar informação, di-lo na narrativa em vez de inventar.
- TERCEIRA PESSOA OBRIGATÓRIA em todos os campos: "feedbackSupervisor", "sugestaoEspecialista", "desviosProcedimento[].detalhe", "pontosPositivos", "followUpDescricao". Exemplos corretos: "A Rute deve confirmar…", "O operador pode melhorar…". Exemplos PROIBIDOS: "tens de…", "faz isso…", "liga-lhe…", "protege-te…".
`.trim();

const SYSTEM_HEADER = `És um supervisor sénior de uma corretora de seguros portuguesa (Alfaseguros). A tua função é ler conversas telefónicas entre operadores comerciais e clientes/leads, analisá-las contra os procedimentos da casa, e produzir feedback específico que ajude os operadores a fechar mais negócio.

Falas e escreves **apenas** em Português europeu. Nunca em Brasileiro. Nunca em Inglês exceto onde for inevitável (ex: "follow-up", "TVDE").

REGRA ABSOLUTA — TOM: Refere-te SEMPRE ao operador na **terceira pessoa**, pelo nome próprio (ex: "A Rute fez bem em…", "O João pode melhorar…"). NUNCA usar segunda pessoa: proibido "tu", "tens", "podes", "deves", "faz", "liga", "marca", "confirma" ou qualquer imperativo/conjugação em tu. Esta regra aplica-se a todos os campos de texto do output JSON.`;

export function buildSystemPrompt(): string {
  return [
    SYSTEM_HEADER,
    "",
    "## Procedimentos internos",
    "",
    PROCEDURES_TEXT,
    "",
    "## Output esperado",
    "",
    SCHEMA_DESCRIPTION,
  ].join("\n");
}

function formatDirection(dir: string | null | undefined): string {
  if (!dir) return "Chamada";
  if (dir === "in" || dir === "inbound") return "Chamada Inbound";
  if (dir === "out" || dir === "outbound") return "Chamada Outbound";
  return `Chamada ${dir}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "(sem hora)";
  // Display HH:mm in UTC fallback if not parseable as Date.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.round(sec - m * 60));
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function buildConversationUserMessage(conv: GroupedConversation): string {
  const agents = conv.agentsInvolved.length > 0
    ? conv.agentsInvolved.map((a) => a.name || `(user_id ${a.id})`).join(", ")
    : "(operador desconhecido)";

  const header = [
    `# Conversa — Cliente ${conv.customerPhone}`,
    `Operador(es): ${agents}`,
    `Legs: ${conv.legCount}${conv.isMultiLeg ? " (multi-chamada)" : ""}`,
    `Duração total: ${formatDuration(conv.durationSec)}`,
  ].join("\n");

  const legBlocks = conv.legs.map((leg, idx) => {
    const lines = [
      `## ${idx + 1}. ${formatTime(leg.startTime)} — ${formatDirection(leg.direction)} (${formatDuration(leg.durationSec)})${leg.agentName ? ` — ${leg.agentName}` : ""}`,
      "",
      leg.ringoverSummary || "(sem resumo Ringover disponível)",
    ];
    return lines.join("\n");
  });

  return [header, "", ...legBlocks].join("\n");
}
