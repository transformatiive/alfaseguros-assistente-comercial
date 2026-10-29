/**
 * O que o Desk diz sobre uma promessa feita numa chamada.
 *
 * Uma promessa ("o Tiago envia a simulação até sexta") vem da análise da
 * chamada, mas o seguimento acontece no Desk. Três erros reais vieram de
 * ignorar o Desk:
 *
 *  - **Ticket fechado, promessa na lista.** O #173005 foi fechado a 08/09
 *    ("seguradoras não aceitam o risco") e a promessa continuou 45 dias como
 *    "simulação por enviar". Fechar o ticket é o agente a dizer que o assunto
 *    acabou; o painel tem de ouvir.
 *  - **Promessa sem ticket.** A ligação chamada → ticket vem dos casos, e
 *    falha muitas vezes. Sem ticket, nenhuma resposta conta como prova e a
 *    linha não tem botão para o Desk. Mas o próprio texto cita o número
 *    ("pedido de cotação #173005"), e o n8n abre um ticket por cada chamada,
 *    no mesmo número de telefone, no mesmo dia.
 *  - **Promessa no painel errado.** Quem atendeu não é sempre quem trata. Se o
 *    ticket aberto do cliente está atribuído a outra pessoa, a promessa é dela.
 *
 * Puro de propósito: recebe os tickets já lidos e decide. O carregamento está
 * em `agente.ts`.
 */

import { lisbonDayBoundsISO, toLisbonDate } from "../lib/dates.js";

export interface TicketDeContexto {
  id: string;
  /** Estado do Negócio no Desk ("GANHO", "PERDIDO", "TRATADO"…), quando há. */
  estadoNegocio?: string | null;
  ticketNumber: string | null;
  statusType: string | null;
  assigneeId: string | null;
  phoneFingerprint: string | null;
  /** ISO. */
  createdTime: string | null;
  /** ISO. Só quando está fechado. */
  closedTime: string | null;
  /**
   * Últimos nove dígitos do campo "Telefone" do próprio ticket, quando é
   * diferente do contacto. Nos formulários de parceiros o contacto é o
   * parceiro e o número do cliente só está aqui.
   */
  telefoneDoTicket?: string | null;
  /** Email do ticket ou do contacto, em minúsculas. */
  email?: string | null;
}

export interface PedidoDeContexto {
  /** O ticket que os casos ligaram à conversa, quando ligaram. */
  linkedTicketId: string | null;
  descricao: string;
  /** Últimos nove dígitos do cliente. */
  fingerprint: string | null;
  /** ISO da chamada. Sem ela não se procura por telefone. */
  chamadaEm: string | null;
  /**
   * Emails que o Desk associa a este número, em minúsculas. Liga os tickets
   * que chegaram por email, com outro telefone ou nenhum.
   */
  emails?: ReadonlySet<string>;
  /**
   * Zoho id de quem fez a chamada. Um ticket anterior à chamada, ou ligado só
   * pelo email, só conta quando é dessa pessoa: é o sinal de que a chamada
   * foi sobre aquele pedido e não sobre outro assunto do mesmo cliente.
   */
  zidDoAgente?: string | null;
}

export interface ContextoDoFollowUp {
  /** Todos os tickets que dizem respeito a esta promessa. */
  relacionados: TicketDeContexto[];
  /** O que a linha mostra e para onde o botão leva. */
  principal: TicketDeContexto | null;
  /**
   * Preenchido quando há tickets e estão **todos** fechados: o mais recente a
   * fechar. Um só aberto chega para a promessa continuar.
   */
  fechadoPor: TicketDeContexto | null;
  /** Responsável do ticket aberto mais recente. Null quando não há aberto. */
  dono: string | null;
}

/**
 * Quantos dias depois da chamada um ticket do mesmo cliente ainda conta.
 * É a mesma janela que o linker de casos usa.
 */
export const DIAS_DE_PROXIMIDADE = 14;

/**
 * Quantos dias antes da chamada um ticket do mesmo cliente ainda conta.
 *
 * Uma chamada é muitas vezes sobre um pedido que já existia: o cliente liga a
 * pedir um ponto de situação de um formulário de há três semanas. Em Outubro
 * de 2026, 10 das 21 promessas que o Tiago marcou como erradas tinham o
 * ticket aberto antes da chamada (o #166416 a 06/08, chamada a 03/09), e o
 * painel nunca o via.
 */
export const DIAS_ANTES_DA_CHAMADA = 60;

/**
 * Estados do negócio que dizem que o assunto está resolvido, mesmo com o
 * ticket ainda aberto. Um negócio GANHO (apólice emitida), PERDIDO (com
 * motivo) ou TRATADO já não pede simulação nem seguimento.
 */
const NEGOCIO_DECIDIDO = new Set(["GANHO", "PERDIDO", "TRATADO"]);

/** O Estado do Negócio guardado nos campos do ticket, em maiúsculas. */
export function estadoDoNegocio(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== "object") return null;
  const v = (customFields as Record<string, unknown>).cf_estado_do_negocio;
  return typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
}

/** O nome do negócio ("Simulação", "Revisão de Contrato"), quando há. */
export function nomeDoNegocio(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== "object") return null;
  const cf = customFields as Record<string, unknown>;
  for (const k of ["cf_negocio_1", "cf_negocio"]) {
    const v = cf[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function negocioDecidido(estado: string | null | undefined): boolean {
  return !!estado && NEGOCIO_DECIDIDO.has(estado.toUpperCase());
}

/** Números de ticket citados no texto: "#173005", "ticket 173005". */
export function numerosCitados(texto: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (texto ?? "").matchAll(/(?:#|ticket\s+(?:n\.?º\s*)?)(\d{5,7})\b/gi)) {
    out.add(m[1]);
  }
  return [...out];
}

/** Fechado ou apagado no Desk, ou com o negócio já decidido: acabou. */
function fechado(t: TicketDeContexto): boolean {
  const estado = (t.statusType ?? "").toLowerCase();
  return estado === "closed" || estado === "deleted" || negocioDecidido(t.estadoNegocio);
}

function instante(iso: string | null): number {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

function quandoFechou(t: TicketDeContexto): number {
  return t.closedTime ? instante(t.closedTime) : Number.MAX_SAFE_INTEGER;
}

/** Mesmo telefone: do contacto ou do campo "Telefone" do ticket. */
function mesmoTelefone(p: PedidoDeContexto, t: TicketDeContexto): boolean {
  return !!p.fingerprint && (t.phoneFingerprint === p.fingerprint || t.telefoneDoTicket === p.fingerprint);
}

function mesmoEmail(p: PedidoDeContexto, t: TicketDeContexto): boolean {
  return !!t.email && !!p.emails && p.emails.has(t.email);
}

/**
 * O ticket ainda estava vivo quando o cliente ligou: aberto, ou fechado
 * depois da chamada.
 *
 * Um ticket que já estava fechado é um assunto antigo e não pode fechar uma
 * promessa nova. Um ticket aberto com o negócio já decidido também fica de
 * fora: não há data da decisão, e não se sabe se ela veio antes da chamada.
 */
function vivoNaChamada(t: TicketDeContexto, chamada: number): boolean {
  const estado = (t.statusType ?? "").toLowerCase();
  if (estado === "deleted") return false;
  if (estado === "closed") {
    const fechou = t.closedTime ? Date.parse(t.closedTime) : NaN;
    return !Number.isNaN(fechou) && fechou >= chamada;
  }
  return !negocioDecidido(t.estadoNegocio);
}

export function lerContexto(
  p: PedidoDeContexto,
  tickets: readonly TicketDeContexto[],
): ContextoDoFollowUp {
  const citados = new Set(numerosCitados(p.descricao));

  let chamada: number | null = null;
  let ate: number | null = null;
  let maisCedo: number | null = null;
  if (p.chamadaEm && !Number.isNaN(Date.parse(p.chamadaEm))) {
    const dia = toLisbonDate(new Date(p.chamadaEm));
    chamada = Date.parse(p.chamadaEm);
    ate = chamada + DIAS_DE_PROXIMIDADE * 86_400_000;
    maisCedo = Date.parse(lisbonDayBoundsISO(dia)[0]) - DIAS_ANTES_DA_CHAMADA * 86_400_000;
  }

  // Três graus de certeza.
  //
  //  - Diretos: o ticket que os casos ligaram, ou o que o texto cita.
  //  - Da chamada: mesmo telefone, aberto depois da chamada e até 14 dias
  //    depois. É o ticket que o n8n abre para a chamada, ou o pedido que ela
  //    gerou.
  //  - Indiretos: abertos antes da chamada (até 60 dias) e ainda vivos nela,
  //    ou ligados só pelo email. É o caso do cliente que liga sobre um pedido
  //    que já existia — 10 das 21 promessas que o Tiago marcou em Outubro.
  //
  // Os indiretos são os que podem enganar: o cliente pode ter outro assunto
  // aberto, e um parceiro tem muitos tickets de clientes diferentes com o
  // mesmo contacto. Por isso só contam quando são de quem fez a chamada e
  // quando há só um. Dois ou mais é ambíguo, e ambíguo não fecha nada.
  const diretos: TicketDeContexto[] = [];
  const daChamada: TicketDeContexto[] = [];
  const indiretos: TicketDeContexto[] = [];
  for (const t of tickets) {
    if (t.ticketNumber && citados.has(t.ticketNumber)) {
      diretos.push(t);
      continue;
    }
    if (p.linkedTicketId && t.id === p.linkedTicketId) {
      // Os casos ligam a chamada ao ticket com atividade mais perto dela, seja
      // qual for a idade dele. Um ticket que já estava fechado quando o
      // cliente ligou é outro assunto, e não pode fechar esta promessa.
      const criadoLigado = t.createdTime ? Date.parse(t.createdTime) : NaN;
      if (chamada !== null && !Number.isNaN(criadoLigado) && criadoLigado < chamada && !vivoNaChamada(t, chamada)) {
        continue;
      }
      diretos.push(t);
      continue;
    }
    if (chamada === null || ate === null || maisCedo === null || !t.createdTime) continue;
    const criado = Date.parse(t.createdTime);
    if (Number.isNaN(criado) || criado > ate || criado < maisCedo) continue;
    const telefone = mesmoTelefone(p, t);
    if (!telefone && !mesmoEmail(p, t)) continue;
    if (telefone && criado >= chamada) {
      daChamada.push(t);
      continue;
    }
    if (criado < chamada && !vivoNaChamada(t, chamada)) continue;
    if (!p.zidDoAgente || t.assigneeId !== p.zidDoAgente) continue;
    indiretos.push(t);
  }
  const indireto = indiretos.length === 1 ? indiretos[0] : null;
  const relacionados = [...diretos, ...daChamada, ...(indireto ? [indireto] : [])];

  const maisRecentePrimeiro = [...relacionados].sort(
    (a, b) => instante(b.createdTime) - instante(a.createdTime),
  );
  const abertos = maisRecentePrimeiro.filter((t) => !fechado(t));

  // O que fechou por último. Um negócio decidido num ticket ainda aberto não
  // tem `closedTime`; conta como o mais recente, porque é o estado de agora.
  const fechadoPor =
    relacionados.length > 0 && abertos.length === 0
      ? [...relacionados].sort((a, b) => quandoFechou(b) - quandoFechou(a))[0]
      : null;

  // O ticket a mostrar, que é também onde se procura a resposta: o que os
  // casos ligaram, depois o que o texto cita, depois o aberto mais recente, e
  // só então o mais recente de todos.
  const principal =
    relacionados.find((t) => t.id === p.linkedTicketId) ??
    relacionados.find((t) => t.ticketNumber !== null && citados.has(t.ticketNumber)) ??
    abertos[0] ??
    maisRecentePrimeiro[0] ??
    null;

  // O dono só vem de um ticket direto ou da chamada. O indireto é de quem fez
  // a chamada por construção, e não pode mudar a promessa de painel.
  const donoDe = abertos.find((t) => t !== indireto);

  return {
    relacionados,
    principal,
    fechadoPor,
    dono: donoDe?.assigneeId ?? null,
  };
}

/**
 * De quem é a promessa.
 *
 * Do responsável do ticket aberto, quando ele é alguém do painel. Senão, de
 * quem fez a chamada. "Alguém do painel" importa: um ticket atribuído à conta
 * de integração, ou a alguém de fora da equipa, não pode fazer a promessa
 * desaparecer de todos os painéis.
 */
export function eDeQuem(params: {
  dono: string | null;
  agenteDaChamada: string | null;
  zidsDaEquipa: ReadonlySet<string>;
  colaborador: { zid: string | null; ringoverUserId: string | null };
}): boolean {
  const { dono, agenteDaChamada, zidsDaEquipa, colaborador } = params;
  if (dono && zidsDaEquipa.has(dono)) return dono === colaborador.zid;
  return !!colaborador.ringoverUserId && agenteDaChamada === colaborador.ringoverUserId;
}

/** "ticket #173005 fechado a 08/09" — a prova que tira a promessa da lista. */
export function descreverFecho(t: TicketDeContexto): string {
  const numero = t.ticketNumber ? `#${t.ticketNumber}` : "do Desk";
  if (negocioDecidido(t.estadoNegocio)) return `negócio ${t.estadoNegocio} no ticket ${numero}`;
  if ((t.statusType ?? "").toLowerCase() === "deleted") return `ticket ${numero} apagado no Desk`;
  if (!t.closedTime) return `ticket ${numero} fechado`;
  const [, m, d] = toLisbonDate(new Date(t.closedTime)).split("-");
  return `ticket ${numero} fechado a ${d}/${m}`;
}

/**
 * Quando foi a chamada: o início da primeira perna com hora.
 *
 * O `updated_at` da conversa, que era usado até aqui, muda sempre que a linha
 * é tocada — uma reanálise, uma correcção em massa — e fazia uma promessa de
 * 03/09 parecer feita noutro dia.
 */
export function inicioDaChamada(legsJson: unknown, runDate: string): string {
  let primeira: number | null = null;
  if (Array.isArray(legsJson)) {
    for (const perna of legsJson) {
      if (!perna || typeof perna !== "object") continue;
      const s = (perna as { startTime?: unknown }).startTime;
      if (typeof s !== "string") continue;
      const t = Date.parse(s);
      if (Number.isNaN(t)) continue;
      if (primeira === null || t < primeira) primeira = t;
    }
  }
  return new Date(primeira ?? Date.parse(lisbonDayBoundsISO(runDate)[0])).toISOString();
}
