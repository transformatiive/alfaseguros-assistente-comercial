/**
 * The panel's tasks: one list of *things to do*, built from four sources.
 *
 * The panel used to have a block per data source — calls here, Desk tickets
 * there, follow-ups somewhere else, the analysis rules in a fourth place. That
 * is the shape of our plumbing, not the shape of an agent's morning, and it
 * forced the agent to do the grouping in their head: read four lists, work out
 * which rows are the same customer, work out which ones they can actually act
 * on right now.
 *
 * So this module regroups everything by **what the task asks of you**:
 *
 *   devolver_chamada    — somebody rang and nobody answered.
 *   enviar_simulacao    — a quote was asked for and has not gone out.
 *   cumprir_compromisso — something was promised on a call.
 *   retomar_conversa    — a sale that lost its momentum.
 *   espera_alfa         — a Desk ticket whose next move is ours.
 *   espera_cliente      — a Desk ticket parked on somebody else.
 *
 * Every task carries the same four things, because they are the four questions
 * an agent asks of any row: **what do I do** (`titulo`), **why**
 * (`porque`), **who with** (`contacto`, always with a way to reach them), and
 * **by when** (`prazo`).
 *
 * Pure on purpose — no database, no clock of its own. It takes the blocks the
 * panel already built and reshapes them, which is why it can be tested with a
 * literal and why adding a category costs one entry here and one icon in the UI.
 */

export type CategoriaTarefa =
  | "devolver_chamada"
  | "enviar_simulacao"
  | "cumprir_compromisso"
  | "retomar_conversa"
  | "espera_alfa"
  | "espera_cliente";

export type PrioridadeTarefa = "alta" | "media" | "baixa";

/** How to reach the person. At least one of the three is always present. */
export interface Contacto {
  /** From the Desk contact, or from the call's own analysis. Null when unknown. */
  nome: string | null;
  telefone: string | null;
  email: string | null;
}

export interface Tarefa {
  id: string;
  categoria: CategoriaTarefa;
  /** What to do, in one line. Never a category label — always the specific act. */
  titulo: string;
  /** Why, in the words of the call or the ticket. Null when there is no context. */
  porque: string | null;
  contacto: Contacto;
  /** When this should be done by, ISO. Null when nothing sets a deadline. */
  prazo: string | null;
  /** How long it has been waiting, in hours. Drives ordering and the age chip. */
  esperaHoras: number | null;
  /** Desk status, verbatim, for the rows that come from a ticket. */
  estado: string | null;
  ticketId: string | null;
  deskUrl: string | null;
  prioridade: PrioridadeTarefa;
  /**
   * Only on `devolver_chamada`, and the reason this field exists at all: the
   * row has a *button*. Closing a call needs its ids, and dropping them when
   * the blocks were regrouped would have quietly removed the one action the
   * panel actually performs.
   */
  devolucaoIds: number[] | null;
  /** Only on `devolver_chamada`: which rule decided this call is this agent's. */
  atribuicaoOrigem: OrigemAtribuicao | null;
}

/** Which rule decided who owns a missed call. */
export type OrigemAtribuicao = "ticket" | "grupo" | "historico" | "chamada";

/* ── Entradas ───────────────────────────────────────────────────────────── */

export interface DevolucaoParaTarefa {
  ids: number[];
  numeroCliente: string;
  tentativas: number;
  primeiraChamada: string;
  contexto: string | null;
  ticketId: string | null;
  atribuicaoOrigem: OrigemAtribuicao | null;
}

export interface FollowUpParaTarefa {
  id: string;
  contact_phone: string | null;
  contact_email: string | null;
  follow_up_descricao: string;
  follow_up_sla_hours: number;
  linked_ticket_id: string | null;
  product: string | null;
  detected_at: string;
}

export interface TicketParaTarefa {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  idadeHoras: number;
  criadoEm: string;
  deskUrl: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface AcaoParaTarefa {
  id: string;
  tipo: string;
  prioridade: PrioridadeTarefa;
  titulo: string;
  descricao: string;
  customerPhone: string;
  contactName: string | null;
}

export interface EntradaTarefas {
  devolucoes: readonly DevolucaoParaTarefa[];
  followUps: readonly FollowUpParaTarefa[];
  tickets: readonly TicketParaTarefa[];
  acoes: readonly AcaoParaTarefa[];
  /** Last 9 digits → the customer's name, from whichever ticket saw them last. */
  nomePorFingerprint: ReadonlyMap<string, string>;
  /** Same, for the email. Desk is the only place either of them exists. */
  emailPorFingerprint: ReadonlyMap<string, string>;
  now: Date;
}

/* ── Regras de classificação ────────────────────────────────────────────── */

/**
 * Desk statuses that mean the ball is in somebody else's court.
 *
 * Everything not listed here is ours — including a status nobody has mapped,
 * because an unrecognised status is far more likely to need a look than to be
 * safely parked.
 */
const ESTADOS_A_AGUARDAR_TERCEIROS = new Set(["espera cliente", "espera companhia"]);

/**
 * Desk tickets that are really Desk *tasks*.
 *
 * These are dropped entirely: the tasks in Desk are being retired and replaced
 * by the ones this panel derives, so showing them is showing the agent work
 * that is about to stop existing — and on a real day it was seventeen of the
 * sixty rows, all of them noise.
 */
const ASSUNTOS_DE_TAREFA = [/^reminder for your task/i, /^lembrete para a sua tarefa/i];

export function ehTarefaDoDesk(subject: string | null): boolean {
  const s = (subject ?? "").trim();
  return ASSUNTOS_DE_TAREFA.some((r) => r.test(s));
}

/** Words that mean "a quote", in ticket subjects and in promises. */
const PALAVRAS_DE_SIMULACAO =
  /simula(c|ç)(a|ã)o|simular|cota(c|ç)(a|ã)o|or(c|ç)amento|proposta|pedido de pre(c|ç)o/i;

/**
 * A ticket that is a request for a quote.
 *
 * The noun alone is enough here, because a Desk subject *is* the request:
 * "VCVIDA - Simulação Seguro Multirriscos - Pedro Marques" needs no verb to
 * mean what it obviously means. Against real data this classified fifteen of
 * fifteen correctly.
 */
export function pedeSimulacao(texto: string | null | undefined): boolean {
  return PALAVRAS_DE_SIMULACAO.test(texto ?? "");
}

/** Verbs that mean the quote itself is the thing being produced or sent. */
const VERBOS_DE_ENVIO =
  /envi|manda|remet|prepar|elabor|fazer (a |uma )?(simula|cota|proposta)|simular|cotar|apresentar|entregar|submeter/i;

/**
 * A *promise* to send a quote — which needs the verb as well as the noun.
 *
 * A promise is a whole sentence about an act, so the noun on its own
 * over-fires: *"Contactar a cliente com uma atualização sobre a decisão da
 * seguradora relativa à proposta de Multirriscos"* is a promise to **call**,
 * not to send anything, and on real data it was the one row this got wrong.
 * Requiring a producing or sending verb alongside the noun fixes it without
 * touching the ticket side, where the noun is the whole point.
 */
export function prometeSimulacao(descricao: string | null | undefined): boolean {
  const t = descricao ?? "";
  return PALAVRAS_DE_SIMULACAO.test(t) && VERBOS_DE_ENVIO.test(t);
}

/** The last nine digits — the only form Ringover and Desk agree on. */
export function impressaoDigital(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return digitos.length >= 9 ? digitos.slice(-9) : null;
}

/**
 * A one-line summary of a promise written as a paragraph.
 *
 * The model writes follow-ups as full instructions — *"Registar no Desk uma
 * tarefa para tentar apurar a data de renovação do seguro de Saúde do cliente
 * na Lusitânia e agendar um novo contacto comercial próximo dessa data."* That
 * is the right thing to keep as the **why**; it is the wrong thing to use as a
 * heading, because a list of seven of them is a list of seven paragraphs.
 *
 * So: drop the bookkeeping preamble (the agent does not need to be told to
 * register a task — this panel *is* the task), take the first clause, and cap
 * it on a word boundary.
 */
const PREAMBULOS = [
  // `\s*` and not `\s+`: the text is trimmed before these run, so a promise
  // that is *only* a preamble has no trailing space left to match.
  /^registar no desk uma tarefa para\s*/i,
  /^criar (uma )?tarefa (no desk )?para\s*/i,
  /^registar (uma )?tarefa para\s*/i,
  /^agendar uma tarefa para\s*/i,
];

export function resumirPromessa(descricao: string, maximo = 72): string {
  let t = descricao.trim();
  for (const p of PREAMBULOS) t = t.replace(p, "");

  // Keep the first clause — the primary act. A sentence end is a full stop or
  // semicolon followed by a space *or by nothing at all*: the last sentence of
  // a paragraph has no space after its full stop, and matching only `[.;]\s`
  // silently kept the punctuation on every single-sentence promise.
  const fim = t.search(/[.;](\s|$)/);
  if (fim >= 0) t = t.slice(0, fim);
  t = t.trim();

  if (t.length > maximo) {
    const corte = t.lastIndexOf(" ", maximo);
    t = t.slice(0, corte > maximo * 0.6 ? corte : maximo).trim();
    // "…do seguro de Saúde do cliente na…" is a worse cut than one word
    // earlier: a title left dangling on a preposition or an article reads as
    // broken rather than as abbreviated.
    t = t.replace(/\s+(de|da|do|das|dos|a|o|as|os|na|no|nas|nos|em|para|com|e|à|ao)$/i, "");
    t += "…";
  }
  if (!t) return "Cumprir o que foi combinado";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Which of the seven analysis rules belong on the task list at all. */
const ACOES_DE_CONVERSA = new Set([
  "risco_perda_lead",
  "cotacao_sem_seguimento",
  "lead_quente_sem_fecho",
  "oportunidade_cross_sell",
]);

/**
 * Rules that are about *how the agent worked*, not about a customer waiting.
 *
 * `desvio_procedimento` and `qualidade_critica` are coaching. Mixing them into
 * a to-do list makes the to-do list something to be defensive about, and the
 * prompt's tone rules were written precisely to avoid that.
 */
export function ehAcaoDeConversa(tipo: string): boolean {
  return ACOES_DE_CONVERSA.has(tipo);
}

/* ── Construção ─────────────────────────────────────────────────────────── */

function horasEntre(de: Date, ate: Date): number {
  return Math.floor((ate.getTime() - de.getTime()) / 3_600_000);
}

function contactoDe(
  telefone: string | null,
  entrada: EntradaTarefas,
  nomeConhecido?: string | null,
): Contacto {
  const fp = impressaoDigital(telefone);
  return {
    nome: nomeConhecido || (fp ? entrada.nomePorFingerprint.get(fp) ?? null : null),
    telefone: telefone || null,
    email: fp ? entrada.emailPorFingerprint.get(fp) ?? null : null,
  };
}

export function derivarTarefas(entrada: EntradaTarefas): Tarefa[] {
  const out: Tarefa[] = [];

  // 1. Chamadas por devolver. No deadline field: the deadline is now, which is
  //    why these sort first and carry the only unconditional `alta`.
  for (const d of entrada.devolucoes) {
    const inicio = new Date(d.primeiraChamada);
    out.push({
      id: `dev_${d.ids[0]}`,
      categoria: "devolver_chamada",
      titulo:
        d.tentativas > 1
          ? `Devolver chamada — ${d.tentativas} tentativas`
          : "Devolver chamada",
      porque: d.contexto,
      contacto: contactoDe(d.numeroCliente, entrada),
      prazo: null,
      esperaHoras: horasEntre(inicio, entrada.now),
      estado: null,
      ticketId: d.ticketId,
      deskUrl: null,
      prioridade: "alta",
      devolucaoIds: d.ids,
      atribuicaoOrigem: d.atribuicaoOrigem,
    });
  }

  // 2 & 3. Promises made on a call. A promise that is about sending a quote is
  //    its own category: it has a recipient and a date, and it is the one kind
  //    of promise where being late loses the sale outright.
  for (const f of entrada.followUps) {
    const detectado = new Date(f.detected_at);
    const prazo = new Date(detectado.getTime() + f.follow_up_sla_hours * 3_600_000);
    const simulacao = prometeSimulacao(f.follow_up_descricao);
    const contacto = contactoDe(f.contact_phone, entrada);
    if (f.contact_email) contacto.email = f.contact_email;

    out.push({
      id: f.id,
      categoria: simulacao ? "enviar_simulacao" : "cumprir_compromisso",
      titulo: simulacao
        ? `Enviar simulação${f.product ? ` — ${f.product}` : ""}`
        : resumirPromessa(f.follow_up_descricao),
      porque: f.follow_up_descricao,
      contacto,
      prazo: prazo.toISOString(),
      esperaHoras: horasEntre(detectado, entrada.now),
      estado: null,
      ticketId: f.linked_ticket_id,
      deskUrl: null,
      // Past its SLA is high; still inside it is a normal day's work.
      prioridade: prazo < entrada.now ? "alta" : "media",
      devolucaoIds: null,
      atribuicaoOrigem: null,
    });
  }

  // 4. Sales that lost momentum. The quality rules are deliberately not here.
  for (const a of entrada.acoes) {
    if (!ehAcaoDeConversa(a.tipo)) continue;
    out.push({
      id: a.id,
      categoria: "retomar_conversa",
      titulo: a.titulo,
      porque: a.descricao,
      contacto: contactoDe(a.customerPhone, entrada, a.contactName),
      prazo: null,
      esperaHoras: null,
      estado: null,
      ticketId: null,
      deskUrl: null,
      prioridade: a.prioridade,
      devolucaoIds: null,
      atribuicaoOrigem: null,
    });
  }

  // 5 & 6. Desk tickets, split by whose move it is.
  for (const t of entrada.tickets) {
    if (ehTarefaDoDesk(t.subject)) continue;

    const estado = (t.status ?? "").trim();
    const aguardaTerceiros = ESTADOS_A_AGUARDAR_TERCEIROS.has(estado.toLowerCase());
    const assunto = t.subject?.trim() || "Pedido sem assunto";
    const simulacao = !aguardaTerceiros && (/^fazer simula/i.test(estado) || pedeSimulacao(assunto));

    out.push({
      id: `tkt_${t.id}`,
      categoria: aguardaTerceiros
        ? "espera_cliente"
        : simulacao
          ? "enviar_simulacao"
          : "espera_alfa",
      titulo: assunto,
      porque: null,
      contacto: {
        nome: t.contactName,
        telefone: t.contactPhone,
        email: t.contactEmail,
      },
      prazo: null,
      esperaHoras: t.idadeHoras,
      estado: estado || null,
      ticketId: t.id,
      deskUrl: t.deskUrl,
      // Waiting on someone else is never urgent to *us*, however old it is.
      prioridade: aguardaTerceiros ? "baixa" : t.idadeHoras >= 72 ? "alta" : "media",
      devolucaoIds: null,
      atribuicaoOrigem: null,
    });
  }

  return out;
}

/* ── Agrupamento para o ecrã ────────────────────────────────────────────── */

export interface GrupoDeTarefas {
  categoria: CategoriaTarefa;
  tarefas: Tarefa[];
}

/**
 * Categories in the order an agent should meet them.
 *
 * Not by size and not by data source: by how much of somebody else's time is
 * being burned while the row sits there. A caller who rang three times is
 * waiting harder than a quote promised this morning, which is waiting harder
 * than a ticket parked on the customer.
 */
export const ORDEM_CATEGORIAS: readonly CategoriaTarefa[] = [
  "devolver_chamada",
  "enviar_simulacao",
  "cumprir_compromisso",
  "espera_alfa",
  "retomar_conversa",
  "espera_cliente",
];

const PESO_PRIORIDADE: Record<PrioridadeTarefa, number> = { alta: 0, media: 1, baixa: 2 };

export function agruparTarefas(tarefas: readonly Tarefa[]): GrupoDeTarefas[] {
  const porCategoria = new Map<CategoriaTarefa, Tarefa[]>();
  for (const t of tarefas) {
    porCategoria.set(t.categoria, [...(porCategoria.get(t.categoria) ?? []), t]);
  }

  return ORDEM_CATEGORIAS.flatMap((categoria) => {
    const lista = porCategoria.get(categoria);
    if (!lista || lista.length === 0) return [];
    // Inside a category: urgency first, then whoever has waited longest.
    const ordenadas = [...lista].sort(
      (a, b) =>
        PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] ||
        (b.esperaHoras ?? 0) - (a.esperaHoras ?? 0),
    );
    return [{ categoria, tarefas: ordenadas }];
  });
}
