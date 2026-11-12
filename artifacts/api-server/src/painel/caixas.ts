/**
 * As caixas do topo do painel: números que o coordenador pediu, cada um com a
 * sua lista e o caminho direto para o ticket.
 *
 *   simulacoesPorEnviar     — o cliente já deu a informação e a simulação ainda
 *                             não saiu. Vermelho ao fim de 24 h (sem contar
 *                             sábados e domingos).
 *   simulacoesSemSeguimento — a simulação saiu e depois não houve conversa com
 *                             o cliente. Vermelho ao fim de 2 horas úteis.
 *   rgpdEmFalta             — ticket fechado com o RGPD ainda "Solicitado".
 *   contactosMarcados       — data e hora de próximo contacto escritas num
 *                             comentário interno do ticket.
 *
 * Pedidos do João Catalão: email de 05/11/2026 ("O meu Painel // Assistente
 * Virtual") para as duas caixas de simulações, e email de 06/11/2026 ("Ponto e
 * alguns assuntos pendentes", pontos 2 e 3) para os contactos marcados e o
 * RGPD. As regras em aberto seguem as propostas do plano enviado a 05/11.
 *
 * Puro de propósito, como `tarefas.ts`: recebe linhas já lidas e devolve as
 * caixas. Sem base de dados nem relógio próprio, para que cada regra se teste
 * com um literal.
 */

import { lisbonInstant, somarDias, toLisbonDate, diaDaSemana } from "../lib/dates.js";
import { lerPrazoComHora } from "./prazos.js";

/* ── Regras ──────────────────────────────────────────────────────────────── */

/** Caixa 1 fica a vermelho ao fim destas horas (sábados e domingos não contam). */
export const HORAS_POR_ENVIAR = 24;
/** Caixa 2 fica a vermelho ao fim destas horas úteis. */
export const HORAS_SEM_SEGUIMENTO = 2;
/** O dia útil, em hora de Lisboa, para a regra das 2 horas. */
export const INICIO_DIA_UTIL = 9;
export const FIM_DIA_UTIL = 19;
/** Uma chamada atendida mais curta do que isto não conta como conversa. */
export const SEGUNDOS_MINIMOS_CHAMADA = 20;
/** Até quando um comentário com próximo contacto ainda é lido. */
export const DIAS_DE_COMENTARIOS = 30;

/** Estados em que a simulação já saiu. */
export const ESTADOS_ENVIADA = new Set(
  ["Espera Follow Up", "Simulação enviada", "Follow-up", "2º Follow-up", "3º Follow-up"].map(norm),
);
/** Estados em que falta informação de alguém: não pode estar "por enviar". */
export const ESTADOS_ESPERA_INFO = new Set(["Espera Cliente", "Espera Companhia", "Espera Terceiros"].map(norm));
/** Estados que já não são nem envio nem seguimento: fora das duas caixas. */
export const ESTADOS_FORA = new Set(
  ["Espera Assinatura do Cliente", "Vencimento Futuro", "ESPERA RETENÇÃO", "Espera Projecto VIDA"].map(norm),
);
/** O passo da automação do Desk que diz que a simulação saiu. */
const PASSOS_ENVIADA = new Set(["simulation_sent", "followup_active", "customer_replied"]);
const NEGOCIO_DECIDIDO = new Set(["GANHO", "PERDIDO", "TRATADO"]);
/** O valor do campo RGPD quando o link foi enviado e o cliente ainda não assinou. */
export const RGPD_PENDENTE = "solicitado";

/* ── Entradas ────────────────────────────────────────────────────────────── */

export interface TicketParaCaixa {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  statusType: string | null;
  createdTime: Date | null;
  modifiedTime: Date | null;
  closedTime: Date | null;
  contactName: string | null;
  contactPhone: string | null;
  /** Últimos 9 dígitos do telefone do contacto. */
  phoneFingerprint: string | null;
  /** Últimos 9 dígitos do campo "Telefone" do próprio ticket. */
  telefoneTicket: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  deskUrl: string;
  /** `cf_negocio_1` ("Simulação", "Pedido de Cotação"...). */
  negocio: string | null;
  /** `cf_negocio` ("SIMULAÇÃO", "Esclarecimento"...). */
  tipoPedido: string | null;
  /** `cf_estado_do_negocio`, em maiúsculas. */
  estadoNegocio: string | null;
  /** `cf_rgpd`. */
  rgpd: string | null;
  /** `cf_auto_step`. */
  passoAutomatico: string | null;
}

export interface ConversaParaCaixa {
  ticketId: string;
  tipo: "thread" | "comment";
  quando: Date;
  /** `in` / `out` nos emails. */
  direcao: string | null;
  autorTipo: string | null;
  /** `undefined` nas conversas gravadas antes de o campo existir. */
  temAnexo?: boolean | null;
  texto: string | null;
}

export interface ChamadaParaCaixa {
  /** Últimos 9 dígitos do número do cliente. */
  fingerprint: string;
  inicio: Date;
  atendida: boolean;
  duracaoS: number | null;
}

/* ── Saída ───────────────────────────────────────────────────────────────── */

export interface LinhaCaixa {
  ticketId: string;
  ticketNumero: string | null;
  assunto: string | null;
  cliente: string | null;
  telefone: string | null;
  responsavel: string | null;
  /** Desde quando conta o relógio desta linha, ISO. */
  desde: string;
  /** Horas que contam para a regra (úteis ou sem fins de semana, conforme a caixa). */
  horas: number;
  vermelha: boolean;
  /** Uma frase curta: porque é que a linha está aqui. */
  nota: string;
  deskUrl: string;
}

export interface Caixa {
  total: number;
  vermelhas: number;
  linhas: LinhaCaixa[];
}

export interface Caixas {
  simulacoesPorEnviar: Caixa;
  simulacoesSemSeguimento: Caixa;
  rgpdEmFalta: Caixa;
  contactosMarcados: Caixa;
}

/* ── Ajudas ──────────────────────────────────────────────────────────────── */

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function fechado(t: TicketParaCaixa): boolean {
  const e = norm(t.statusType);
  return e === "closed" || e === "deleted";
}

/**
 * Horas entre `a` e `b` que caem dentro da janela diária [inicio, fim[ (hora
 * de Lisboa), só de segunda a sexta. Com 0 e 24 conta o dia inteiro, o que
 * dá "horas sem contar fins de semana".
 */
export function horasNaJanela(a: Date, b: Date, inicio: number, fim: number): number {
  if (b.getTime() <= a.getTime()) return 0;
  let total = 0;
  let dia = toLisbonDate(a);
  const ultimo = toLisbonDate(b);
  for (let i = 0; dia <= ultimo && i < 4000; i++, dia = somarDias(dia, 1)) {
    const w = diaDaSemana(dia);
    if (w === 0 || w === 6) continue;
    const ini = lisbonInstant(dia, inicio).getTime();
    const end = fim >= 24 ? lisbonInstant(somarDias(dia, 1), 0).getTime() : lisbonInstant(dia, fim).getTime();
    const de = Math.max(ini, a.getTime());
    const ate = Math.min(end, b.getTime());
    if (ate > de) total += ate - de;
  }
  return total / 3_600_000;
}

export const horasUteis = (a: Date, b: Date) => horasNaJanela(a, b, INICIO_DIA_UTIL, FIM_DIA_UTIL);
export const horasSemFimDeSemana = (a: Date, b: Date) => horasNaJanela(a, b, 0, 24);

/** É um ticket de simulação: pelo negócio, pelo tipo de pedido ou pelo estado. */
export function eSimulacao(t: TicketParaCaixa): boolean {
  if (norm(t.negocio) === "simulacao") return true;
  if (norm(t.tipoPedido) === "simulacao") return true;
  const e = norm(t.status);
  return e === "fazer simulacao" || e === "simulacao enviada";
}

function enviadaPeloEstado(t: TicketParaCaixa): boolean {
  return ESTADOS_ENVIADA.has(norm(t.status)) || PASSOS_ENVIADA.has(norm(t.passoAutomatico));
}

function emailNossoComSimulacao(c: ConversaParaCaixa): boolean {
  if (c.tipo !== "thread" || norm(c.direcao) !== "out") return false;
  if (c.autorTipo && norm(c.autorTipo) !== "agent") return false;
  if (c.temAnexo === true) return true;
  // Conversas lidas antes de guardarmos os anexos: vale o texto do email.
  if (c.temAnexo == null) return /simula[cç][aã]o|simula[cç][oõ]es|simulamos|simulado/i.test(c.texto ?? "");
  return false;
}

function mensagemDoCliente(c: ConversaParaCaixa): boolean {
  return c.tipo === "thread" && norm(c.direcao) === "in";
}

function emailNosso(c: ConversaParaCaixa): boolean {
  return c.tipo === "thread" && norm(c.direcao) === "out";
}

/**
 * Quando saiu a simulação, ou `null` se ainda não saiu.
 *
 * O primeiro sinal é um email nosso com anexo (a equipa envia a simulação em
 * anexo). O segundo é o estado do ticket ("Espera Follow Up" e afins): quando
 * só o estado diz que saiu, a hora é a do último email nosso, ou a última
 * alteração do ticket.
 */
export function momentoDoEnvio(
  t: TicketParaCaixa,
  conversas: readonly ConversaParaCaixa[],
): { quando: Date; porEstado: boolean } | null {
  const comAnexo = conversas.filter(emailNossoComSimulacao).sort((a, b) => b.quando.getTime() - a.quando.getTime());
  if (comAnexo.length > 0) return { quando: comAnexo[0].quando, porEstado: false };
  if (!enviadaPeloEstado(t)) return null;
  const ultimoNosso = conversas.filter(emailNosso).sort((a, b) => b.quando.getTime() - a.quando.getTime())[0];
  const quando = ultimoNosso?.quando ?? t.modifiedTime ?? t.createdTime;
  return quando ? { quando, porEstado: true } : null;
}

function numerosDoCliente(t: TicketParaCaixa): Set<string> {
  return new Set([t.phoneFingerprint, t.telefoneTicket].filter((x): x is string => !!x && x.length === 9));
}

function conversaAtendida(c: ChamadaParaCaixa): boolean {
  return c.atendida && (c.duracaoS ?? 0) >= SEGUNDOS_MINIMOS_CHAMADA;
}

function linha(t: TicketParaCaixa, desde: Date, horas: number, vermelha: boolean, nota: string): LinhaCaixa {
  return {
    ticketId: t.id,
    ticketNumero: t.ticketNumber,
    assunto: t.subject,
    cliente: t.contactName,
    telefone: t.contactPhone,
    responsavel: t.assigneeName,
    desde: desde.toISOString(),
    horas: Math.round(horas * 10) / 10,
    vermelha,
    nota,
    deskUrl: t.deskUrl,
  };
}

function caixa(linhas: LinhaCaixa[], ordem: "antigas" | "recentes" = "antigas"): Caixa {
  const ord = [...linhas].sort((a, b) =>
    ordem === "antigas" ? a.desde.localeCompare(b.desde) : b.desde.localeCompare(a.desde),
  );
  return { total: ord.length, vermelhas: ord.filter((l) => l.vermelha).length, linhas: ord };
}

/* ── Caixas 1 e 2: simulações ────────────────────────────────────────────── */

export type EstadoSimulacao =
  | { caixa: "por_enviar"; linha: LinhaCaixa }
  | { caixa: "sem_seguimento"; linha: LinhaCaixa }
  | { caixa: null; motivo: string };

export function classificarSimulacao(
  t: TicketParaCaixa,
  conversas: readonly ConversaParaCaixa[],
  chamadas: readonly ChamadaParaCaixa[],
  now: Date,
): EstadoSimulacao {
  if (!eSimulacao(t)) return { caixa: null, motivo: "não é simulação" };
  if (fechado(t)) return { caixa: null, motivo: "ticket fechado" };
  if (t.estadoNegocio && NEGOCIO_DECIDIDO.has(t.estadoNegocio.toUpperCase())) {
    return { caixa: null, motivo: "negócio decidido" };
  }
  const estado = norm(t.status);
  if (ESTADOS_FORA.has(estado)) return { caixa: null, motivo: "estado fora das caixas" };

  const envio = momentoDoEnvio(t, conversas);

  if (!envio) {
    if (ESTADOS_ESPERA_INFO.has(estado)) return { caixa: null, motivo: "à espera de informação" };
    const ultimaDoCliente = conversas
      .filter(mensagemDoCliente)
      .sort((a, b) => b.quando.getTime() - a.quando.getTime())[0];
    const desde = ultimaDoCliente?.quando ?? t.createdTime;
    if (!desde) return { caixa: null, motivo: "sem data" };
    const horas = horasSemFimDeSemana(desde, now);
    return {
      caixa: "por_enviar",
      linha: linha(
        t,
        desde,
        horas,
        horas > HORAS_POR_ENVIAR,
        ultimaDoCliente ? "Última mensagem do cliente, sem simulação enviada depois" : "Pedido aberto, sem simulação enviada",
      ),
    };
  }

  const numeros = numerosDoCliente(t);
  const falou = chamadas.some(
    (c) => numeros.has(c.fingerprint) && conversaAtendida(c) && c.inicio.getTime() > envio.quando.getTime(),
  );
  if (falou) return { caixa: null, motivo: "houve chamada atendida depois do envio" };
  const respondeu = conversas.some(
    (c) => mensagemDoCliente(c) && c.quando.getTime() > envio.quando.getTime(),
  );
  if (respondeu) return { caixa: null, motivo: "o cliente respondeu depois do envio" };

  const horas = horasUteis(envio.quando, now);
  return {
    caixa: "sem_seguimento",
    linha: linha(
      t,
      envio.quando,
      horas,
      horas > HORAS_SEM_SEGUIMENTO,
      envio.porEstado
        ? `Estado "${t.status}", sem chamada atendida nem resposta do cliente depois`
        : "Simulação enviada em anexo, sem chamada atendida nem resposta do cliente depois",
    ),
  };
}

/* ── Caixa 3: RGPD em falta ──────────────────────────────────────────────── */

export function rgpdEmFalta(t: TicketParaCaixa): LinhaCaixa | null {
  if (norm(t.rgpd) !== RGPD_PENDENTE) return null;
  if (!fechado(t) || norm(t.statusType) === "deleted") return null;
  const desde = t.closedTime ?? t.modifiedTime ?? t.createdTime;
  if (!desde) return null;
  return linha(t, desde, 0, false, 'Ticket fechado com o RGPD "Solicitado"');
}

/* ── Caixa 4: contactos marcados nos comentários ─────────────────────────── */

/*
 * Só verbos de ação nossa. "Agendado" ficou de fora de propósito: "débito
 * agendado para 23/11" é a data de um pagamento, não um contacto (caso real,
 * #186802 do Tiago, 02/11/2026).
 */
const GATILHO =
  /(pr[óo]xim[oa]\s+(?:contacto|chamada|liga[cç][aã]o)|\brecontactar\b|voltar\s+a\s+(?:ligar|contactar)|\bligar\b|\bcontactar\b|\btelefonar\b|agendar\s+(?:contacto|chamada|liga[cç][aã]o)|follow[\s-]?up|lembrete)/i;

const DIAS_SEMANA: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

export interface ContactoLido {
  quando: Date;
  /** Se a hora foi escrita. Sem hora, conta o fim do dia útil. */
  comHora: boolean;
}

/**
 * A data (e hora) de próximo contacto escrita num comentário.
 *
 * Só lê depois de uma palavra que diz que é um contacto a fazer ("próximo
 * contacto", "ligar", "recontactar", "follow up"...), e só nos 60 caracteres
 * seguintes, para não confundir com a data de início de uma apólice.
 */
export function lerProximoContacto(texto: string | null | undefined, escritoEm: Date): ContactoLido | null {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const g = GATILHO.exec(t);
  if (!g) return null;
  const resto = t.slice(g.index, g.index + g[0].length + 60);
  const ref = toLisbonDate(escritoEm);
  const restoN = norm(resto);

  let dia: string | null = null;
  const dm = /\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/.exec(resto);
  if (dm) {
    const d = +dm[1];
    const m = +dm[2];
    let y = dm[3] ? +dm[3] : +ref.slice(0, 4);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let cand = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // Sem ano escrito, uma data muito para trás é do ano seguinte (dezembro → janeiro).
      if (!dm[3] && cand < somarDias(ref, -182)) cand = `${y + 1}${cand.slice(4)}`;
      dia = cand;
    }
  } else if (/\bamanha\b/.test(restoN)) {
    dia = somarDias(ref, 1);
  } else if (/\bhoje\b/.test(restoN)) {
    dia = ref;
  } else {
    const ds = /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.exec(restoN);
    if (ds) {
      const alvo = DIAS_SEMANA[ds[1]];
      let d = somarDias(ref, 1);
      for (let i = 0; i < 7 && diaDaSemana(d) !== alvo; i++) d = somarDias(d, 1);
      dia = d;
    } else {
      const so = /\bdia\s+(\d{1,2})\b(?![/\-.]\d)/.exec(restoN);
      if (so) {
        const d = +so[1];
        if (d >= 1 && d <= 31) {
          let cand = `${ref.slice(0, 8)}${String(d).padStart(2, "0")}`;
          if (cand < ref) cand = `${somarDias(`${ref.slice(0, 8)}01`, 32).slice(0, 8)}${String(d).padStart(2, "0")}`;
          dia = cand;
        }
      }
    }
  }

  if (!dia) {
    // As formas que o painel já sabe ler nas promessas ("até sexta-feira",
    // "na próxima semana", "a partir de 17/11").
    const p = lerPrazoComHora(resto, escritoEm, { promessa: true });
    return p ? { quando: p.quando, comHora: p.hora === "combinada" } : null;
  }

  // Hora: "às 10h", "10h30", "10:30", "pelas 15".
  const hm =
    /\b(?:[àa]s|pelas)\s+(\d{1,2})(?:\s*[h:]\s*([0-5]\d))?\b/i.exec(resto) ??
    /\b(\d{1,2})\s*h\s*([0-5]\d)?\b/i.exec(resto) ??
    /\b(\d{1,2}):([0-5]\d)\b/.exec(resto);
  if (hm) {
    const h = +hm[1];
    if (h >= 7 && h <= 21) return { quando: lisbonInstant(dia, h, hm[2] ? +hm[2] : 0), comHora: true };
  }
  return { quando: lisbonInstant(dia, 18), comHora: false };
}

export function contactoMarcado(
  t: TicketParaCaixa,
  conversas: readonly ConversaParaCaixa[],
  chamadas: readonly ChamadaParaCaixa[],
  now: Date,
): LinhaCaixa | null {
  if (fechado(t)) return null;
  const limite = now.getTime() - DIAS_DE_COMENTARIOS * 86_400_000;
  const comentarios = conversas
    .filter((c) => c.tipo === "comment" && (!c.autorTipo || norm(c.autorTipo) === "agent"))
    .filter((c) => c.quando.getTime() >= limite)
    .sort((a, b) => b.quando.getTime() - a.quando.getTime());

  for (const c of comentarios) {
    const lido = lerProximoContacto(c.texto, c.quando);
    if (!lido) continue;
    // Uma data anterior ao próprio comentário fala do passado, não de um contacto a fazer.
    if (toLisbonDate(lido.quando) < toLisbonDate(c.quando)) continue;

    // Feito: chamada atendida com o cliente, ou email nosso, desde o dia marcado
    // (e sempre depois do comentário).
    const inicioDoDia = lisbonInstant(toLisbonDate(lido.quando), 0).getTime();
    const aPartirDe = Math.max(inicioDoDia, c.quando.getTime());
    const numeros = numerosDoCliente(t);
    const feito =
      chamadas.some((ch) => numeros.has(ch.fingerprint) && conversaAtendida(ch) && ch.inicio.getTime() >= aPartirDe) ||
      conversas.some((x) => emailNosso(x) && x.quando.getTime() >= aPartirDe);
    if (feito) return null;

    const atrasado = now.getTime() > lido.quando.getTime();
    const horas = atrasado ? (now.getTime() - lido.quando.getTime()) / 3_600_000 : 0;
    const hoje = toLisbonDate(lido.quando) === toLisbonDate(now);
    const texto = (c.texto ?? "").replace(/\s+/g, " ").trim();
    return {
      ...linha(t, lido.quando, horas, atrasado, ""),
      nota: `${atrasado ? "Atrasado" : hoje ? "Hoje" : "Marcado"}${lido.comHora ? "" : " (sem hora)"}: "${
        texto.length > 140 ? `${texto.slice(0, 140)}…` : texto
      }"`,
    };
  }
  return null;
}

/* ── Tudo junto ──────────────────────────────────────────────────────────── */

export function montarCaixas(entrada: {
  tickets: readonly TicketParaCaixa[];
  conversas: readonly ConversaParaCaixa[];
  chamadas: readonly ChamadaParaCaixa[];
  now: Date;
}): Caixas {
  const porTicket = new Map<string, ConversaParaCaixa[]>();
  for (const c of entrada.conversas) {
    const l = porTicket.get(c.ticketId);
    if (l) l.push(c);
    else porTicket.set(c.ticketId, [c]);
  }

  const porEnviar: LinhaCaixa[] = [];
  const semSeguimento: LinhaCaixa[] = [];
  const rgpd: LinhaCaixa[] = [];
  const contactos: LinhaCaixa[] = [];

  for (const t of entrada.tickets) {
    const conv = porTicket.get(t.id) ?? [];
    const sim = classificarSimulacao(t, conv, entrada.chamadas, entrada.now);
    if (sim.caixa === "por_enviar") porEnviar.push(sim.linha);
    else if (sim.caixa === "sem_seguimento") semSeguimento.push(sim.linha);

    const r = rgpdEmFalta(t);
    if (r) rgpd.push(r);

    const c = contactoMarcado(t, conv, entrada.chamadas, entrada.now);
    if (c) contactos.push(c);
  }

  return {
    simulacoesPorEnviar: caixa(porEnviar),
    simulacoesSemSeguimento: caixa(semSeguimento),
    rgpdEmFalta: caixa(rgpd, "recentes"),
    contactosMarcados: caixa(contactos),
  };
}

/** Junta as caixas de várias pessoas (vista da equipa). */
export function juntarCaixas(lista: readonly Caixas[]): Caixas {
  const juntar = (k: keyof Caixas, ordem: "antigas" | "recentes" = "antigas") =>
    caixa(
      lista.flatMap((c) => c[k].linhas),
      ordem,
    );
  return {
    simulacoesPorEnviar: juntar("simulacoesPorEnviar"),
    simulacoesSemSeguimento: juntar("simulacoesSemSeguimento"),
    rgpdEmFalta: juntar("rgpdEmFalta", "recentes"),
    contactosMarcados: juntar("contactosMarcados"),
  };
}
