import { PROCEDURES_TEXT } from "../procedures/procedures.js";
import type { GroupedConversation } from "../grouping/conversations.js";

const SCHEMA_DESCRIPTION = `
Devolve **apenas** JSON válido (sem markdown, sem comentários) com a seguinte estrutura:

{
  "categoria": string,                       // Cotação | Renovação | Sinistro | Informação | Pós-venda | Outro
  "produto": string,                         // TVDE | Auto | Multirriscos | Condomínio | Saúde | Empresas | Outro
  "narrativaConversa": string,               // 3-8 frases em ordem cronológica. A história completa: o que o cliente queria, o que aconteceu nas chamadas e — se houver tickets Zoho Desk realmente relacionados com ESTA chamada — como se integram temporalmente (ex: "No mesmo dia foi aberto o ticket #X onde..."). IGNORA tickets que, após leres o conteúdo, não estejam relacionados com esta conversa específica (mesmo cliente, assunto diferente).
  "arcoConversa": string,                    // ex: "Frio→Quente", "Estagnado", "Quente→Esfriou", "Direto ao Fecho"
  "sentimentoClienteEvolucao": string,       // 1-2 frases sobre como o sentimento do cliente evoluiu ao longo das chamadas e interações
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
  "tags": string[],                          // 1-5 etiquetas curtas em maiúsculas, ex: ["TVDE", "OBJEÇÃO PREÇO", "PROMESSA RETORNO"]
  "ticketsRelevantes": string[]              // Números dos tickets Zoho genuinamente relacionados com ESTA conversa. Copia o número exactamente como aparece no cabeçalho "Ticket #N", sem o sinal #. Array vazio [] se nenhum for relevante. Exemplo: ["123456", "789012"]
}

Regras de qualidade:
- Sê específico. Cita nomes de operadores, valores, momentos concretos.
- Tom coaching: a ferramenta serve para ajudar o operador a crescer, não para vigiar. Descreve comportamentos e padrões observados — nunca intenções ou traços de carácter. Quando existe uma falha, descreve o comportamento e o seu impacto, sem atribuir negligência ou má vontade. Nos campos feedbackSupervisor e desviosProcedimento[].detalhe usa framing de desenvolvimento ("X tem uma oportunidade de...", "Uma área a reforçar é...") em vez de linguagem acusatória. PROIBIDO: "parece não estar a ver", "não interiorizou", "ignora", "falha sistematicamente", "não percebe".
- EU-PT (Português europeu) sempre. Sem brasileirismos.
- Se faltar informação, di-lo na narrativa em vez de inventar.
- TERCEIRA PESSOA OBRIGATÓRIA em todos os campos: "feedbackSupervisor", "sugestaoEspecialista", "desviosProcedimento[].detalhe", "pontosPositivos", "followUpDescricao". Exemplos corretos: "A Rute deve confirmar…", "O operador pode melhorar…". Exemplos PROIBIDOS: "tens de…", "faz isso…", "liga-lhe…", "protege-te…".
- NEGRITO: Nos campos de texto livre (narrativaConversa, feedbackSupervisor, pontosPositivos, desviosProcedimento[].detalhe, sugestaoEspecialista, followUpDescricao) usa a sintaxe markdown '**texto em negrito**' para destacar: o comportamento concreto mais relevante, o nome do procedimento cumprido ou violado, e o impacto identificado. Máximo 2-3 negritos por campo ou item — não negrites tudo.
`.trim();

const SYSTEM_HEADER = `És um supervisor sénior de uma corretora de seguros portuguesa (Alfaseguros). A tua função é ler conversas telefónicas entre operadores comerciais e clientes/leads, analisá-las contra os procedimentos da casa, e produzir feedback específico que ajude os operadores a fechar mais negócio.

Falas e escreves **apenas** em Português europeu. Nunca em Brasileiro. Nunca em Inglês exceto onde for inevitável (ex: "follow-up", "TVDE").

REGRA ABSOLUTA — PESSOA GRAMATICAL (aplica-se a TODOS os campos de texto do output JSON):
Usa SEMPRE a terceira pessoa, referindo o operador pelo nome próprio com artigo.
EXEMPLOS CORRETOS: "A Rute fez bem em…", "O João fechou a chamada sem…", "O Tiago identificou o teto de preço — isso é um ponto forte.", "A Ana terminou sem combinar o próximo passo."
PROIBIDO — segunda pessoa (conjugações em -ste/-stes, formas de tu):
  "fizeste", "saíste", "deixaste", "confirmaste", "encerraste", "identificaste", "percebeste", "ligaste" — qualquer forma com este padrão.
PROIBIDO — primeira pessoa do supervisor:
  "percebo", "vejo", "noto", "entendo", "reconheço" — o supervisor não fala de si mesmo.
PROIBIDO — possessivos de segunda pessoa:
  "teu", "tua", "o teu", "a tua", "culpa tua", "o teu cliente".
PROIBIDO — vocativo + conjugação em tu:
  "Tiago, fizeste…", "Ana, encerraste…", "João, identificaste…" — mesmo com o nome próprio no início, se o verbo for em tu, é PROIBIDO.
CORRETO para o mesmo caso: "O Tiago fez bem em…", "A Ana encerrou a chamada sem…"`;

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

export interface RelatedTicketForPrompt {
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  category: string | null;
  assigneeName: string | null;
  createdTime: string | null;
  closedTime: string | null;
  comments: Array<{
    commentedTime: string | null;
    authorType: string | null;
    authorName: string | null;
    channel: string | null;
    content: string | null;
  }>;
}

function formatDirection(dir: string | null | undefined): string {
  if (!dir) return "Chamada";
  if (dir === "in" || dir === "inbound") return "Chamada Inbound";
  if (dir === "out" || dir === "outbound") return "Chamada Outbound";
  return `Chamada ${dir}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "(sem hora)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "(sem data)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate().toString().padStart(2, "0");
  const mon = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${day}/${mon} ${hh}:${mm}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.round(sec - m * 60));
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatTickets(tickets: RelatedTicketForPrompt[]): string {
  const lines: string[] = [
    "## Contexto Zoho Desk (tickets selecionados por proximidade temporal com esta conversa)",
    "",
    "ATENÇÃO: Estes tickets foram pré-selecionados por estarem temporalmente próximos desta chamada (criados ou com atividade recente dentro de ±14 dias). Verifica no conteúdo de cada ticket se está de facto relacionado com esta conversa específica — pode ser o mesmo cliente mas sobre assunto diferente. Só inclui na narrativa os tickets que forem genuinamente relevantes para esta chamada.",
    "",
  ];

  for (const t of tickets) {
    const header = [
      `### Ticket #${t.ticketNumber ?? "?"} — "${t.subject ?? "(sem assunto)"}"`,
      `Estado: ${t.status ?? "?"} | Categoria: ${t.category ?? "—"} | Atribuído: ${t.assigneeName ?? "—"}`,
      `Criado: ${formatShortDateTime(t.createdTime)}${t.closedTime ? ` | Fechado: ${formatShortDateTime(t.closedTime)}` : ""}`,
    ];
    lines.push(...header);

    if (t.comments.length === 0) {
      lines.push("(sem comentários registados)");
    } else {
      lines.push("");
      for (const c of t.comments) {
        const ts = formatShortDateTime(c.commentedTime);
        const who = c.authorName ?? (c.authorType === "END_USER" ? "Cliente" : "Agente");
        const type = c.authorType === "END_USER" ? "Mensagem do cliente" : "Nota interna";
        const channel = c.channel ? ` [${c.channel}]` : "";
        lines.push(`  [${ts}${channel}] ${type} — ${who}`);
        if (c.content) {
          lines.push(`  "${c.content.trim()}"`);
        }
        lines.push("");
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildConversationUserMessage(
  conv: GroupedConversation,
  tickets?: RelatedTicketForPrompt[],
): string {
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

  const ticketSection = tickets && tickets.length > 0
    ? formatTickets(tickets)
    : null;

  return [
    header,
    "",
    ...legBlocks,
    ...(ticketSection ? ["", ticketSection] : []),
  ].join("\n");
}
