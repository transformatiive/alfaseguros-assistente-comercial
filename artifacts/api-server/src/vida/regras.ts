import { toLisbonDate, somarDias } from "../lib/dates.js";

/**
 * Regras do pipeline Vida, sobre o espelho do noCRM. Funções puras: recebem as
 * linhas já lidas e o "agora", devolvem números e listas. Testadas em
 * `regras.test.ts`.
 *
 * Vocabulário:
 *  - previsto: uma lead que estava na agenda do dia (próxima acção nesse dia,
 *    fotografada na primeira leitura do dia — ver `nocrm_agenda`);
 *  - feito: a lead teve uma acção registada nesse dia (chamada com conversa,
 *    chamada à mão, email, nota, mudança de passo, ganha/perdida);
 *  - tentou: só houve chamadas de 0 segundos nesse dia;
 *  - não feito: nada, e a hora já passou.
 */

export interface LeadR {
  id: number;
  titulo: string;
  passo: string | null;
  estado: string;
  userId: number | null;
  valor: number | null;
  origem: string | null;
  tags: string[];
  criadaEm: Date;
  fechadaEm: Date | null;
  proximaAcaoDia: string | null;
  proximaAcaoHora: string | null;
  passoDesde: Date | null;
}

export interface EventoR {
  leadId: number;
  tipo: string;
  userId: number | null;
  ocorreuEm: Date;
  duracaoSeg: number | null;
  valor: string | null;
}

export interface AgendaR {
  dia: string;
  leadId: number;
  userId: number | null;
  hora: string | null;
  passo: string | null;
}

export const ABERTOS = new Set(["todo", "standby"]);
export const aberta = (l: Pick<LeadR, "estado">): boolean => ABERTOS.has(l.estado);

export const PASSOS = [
  "Por contactar",
  "Contactado",
  "Simulação enviada",
  "Não ata nem desata",
  "Proposta enviada",
  "Enviado Emissão - Cliente",
  "Enviado para Emissão - Companhia",
] as const;

/** Dias que uma lead pode ficar em cada passo antes de contar como parada. Proposta, a validar com o Rui e o Hélio. */
export const PRAZO_PASSO_DIAS: Record<string, number> = {
  "Por contactar": 1,
  Contactado: 3,
  "Simulação enviada": 5,
  "Não ata nem desata": 30,
  "Proposta enviada": 7,
  "Enviado Emissão - Cliente": 7,
  "Enviado para Emissão - Companhia": 14,
};

export const PRIMEIRO_CONTACTO_HORAS = 2;
export const SIMULACAO_SEM_SEGUIMENTO_DIAS = 5;
export const NAO_ATA_DIAS = 30;
export const TENTATIVAS_ALERTA = 5;

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Uma chamada em que houve conversa (ou registada à mão, sem duração). */
export const eConversa = (e: EventoR): boolean => e.tipo === "chamada" && (e.duracaoSeg == null || e.duracaoSeg > 0);
export const eTentativa = (e: EventoR): boolean => e.tipo === "chamada" && e.duracaoSeg === 0;
/** Contacto com o cliente: conversa ou email. */
export const eContacto = (e: EventoR): boolean => eConversa(e) || e.tipo === "email";

/**
 * Conta como acção feita. Fica de fora a passagem automática de "em espera"
 * para "a fazer": o noCRM fá-la sozinho no dia do lembrete e regista-a com o
 * nome do dono, o que faria parecer que alguém trabalhou a lead.
 */
export function eAcao(e: EventoR): boolean {
  if (e.tipo === "chamada") return !eTentativa(e);
  if (e.tipo === "email" || e.tipo === "nota" || e.tipo === "passo") return true;
  if (e.tipo === "estado") return e.valor === "won" || e.valor === "lost" || e.valor === "cancelled";
  return false;
}

export type EstadoAgenda = "feito" | "tentou" | "nao_feito" | "mais_logo";

function porLead(eventos: EventoR[]): Map<number, EventoR[]> {
  const m = new Map<number, EventoR[]>();
  for (const e of eventos) {
    const a = m.get(e.leadId);
    if (a) a.push(e);
    else m.set(e.leadId, [e]);
  }
  for (const a of m.values()) a.sort((x, y) => x.ocorreuEm.getTime() - y.ocorreuEm.getTime());
  return m;
}

/** Hora "HH:MM" em Lisboa de um instante. */
export function horaLisboa(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function estadoDaAgenda(item: AgendaR, eventosDaLead: EventoR[], agora: Date): EstadoAgenda {
  const doDia = eventosDaLead.filter((e) => toLisbonDate(e.ocorreuEm) === item.dia);
  if (doDia.some(eAcao)) return "feito";
  if (doDia.some(eTentativa)) return "tentou";
  const hoje = toLisbonDate(agora);
  if (item.dia < hoje) return "nao_feito";
  if (item.dia > hoje) return "mais_logo";
  // Hoje: só falhou se a hora marcada já passou. Sem hora, fica para o fim do dia.
  if (item.hora && /^\d{2}:\d{2}$/.test(item.hora) && item.hora < horaLisboa(agora)) return "nao_feito";
  return "mais_logo";
}

export interface AgendaComEstado extends AgendaR {
  estado: EstadoAgenda;
}

export function agendaComEstado(agenda: AgendaR[], eventos: EventoR[], agora: Date): AgendaComEstado[] {
  const m = porLead(eventos);
  return agenda.map((a) => ({ ...a, estado: estadoDaAgenda(a, m.get(a.leadId) ?? [], agora) }));
}

/** A próxima acção ficou para trás: o dia marcado é anterior a hoje. */
export function atrasada(l: LeadR, hoje: string): boolean {
  return aberta(l) && l.proximaAcaoDia != null && l.proximaAcaoDia < hoje;
}

export function diasNoPasso(l: LeadR, agora: Date): number {
  const desde = l.passoDesde ?? l.criadaEm;
  return Math.floor((agora.getTime() - desde.getTime()) / DIA);
}

export function parada(l: LeadR, agora: Date): boolean {
  if (!aberta(l) || !l.passo) return false;
  const prazo = PRAZO_PASSO_DIAS[l.passo];
  return prazo != null && diasNoPasso(l, agora) > prazo;
}

// ---------------------------------------------------------------- alertas

export type TipoAlerta = "nova_sem_contacto" | "por_designar" | "acao_falhada" | "simulacao_sem_seguimento" | "nao_ata" | "tentativas";

export const ALERTA_NOME: Record<TipoAlerta, string> = {
  nova_sem_contacto: "Lead nova sem contacto",
  por_designar: "Lead por designar",
  acao_falhada: "Próxima ação falhada",
  simulacao_sem_seguimento: "Simulação sem seguimento",
  nao_ata: "Não ata nem desata",
  tentativas: "Muitas tentativas sem resposta",
};

export interface Alerta {
  tipo: TipoAlerta;
  leadId: number;
  titulo: string;
  passo: string | null;
  userId: number | null;
  desde: string;
  fazer: string;
}

const ORDEM: TipoAlerta[] = ["nova_sem_contacto", "por_designar", "acao_falhada", "simulacao_sem_seguimento", "tentativas", "nao_ata"];

export function calcularAlertas(params: {
  leads: LeadR[];
  eventos: EventoR[];
  agendaRecente: AgendaR[];
  agora: Date;
}): Alerta[] {
  const { leads, eventos, agendaRecente, agora } = params;
  const m = porLead(eventos);
  const porId = new Map(leads.map((l) => [l.id, l]));
  const out: Alerta[] = [];
  const hoje = toLisbonDate(agora);

  for (const l of leads) {
    if (!aberta(l)) continue;
    const ev = m.get(l.id) ?? [];
    const base = { leadId: l.id, titulo: l.titulo, passo: l.passo, userId: l.userId };
    const idadeH = (agora.getTime() - l.criadaEm.getTime()) / HORA;

    if (l.passo === "Por contactar" && idadeH > PRIMEIRO_CONTACTO_HORAS && idadeH < 14 * 24) {
      const contactada = ev.some((e) => eContacto(e) && e.ocorreuEm >= l.criadaEm);
      if (!contactada) {
        out.push({ ...base, tipo: "nova_sem_contacto", desde: l.criadaEm.toISOString(), fazer: `Ligar. Entrou há ${Math.floor(idadeH)} h e ainda não teve contacto.` });
      }
    }

    if (l.userId == null && idadeH > 24) {
      out.push({ ...base, tipo: "por_designar", desde: l.criadaEm.toISOString(), fazer: "Atribuir a uma pessoa da equipa." });
    }

    const dias = diasNoPasso(l, agora);
    if (l.passo === "Simulação enviada" && dias > SIMULACAO_SEM_SEGUIMENTO_DIAS) {
      const ultimaConversa = [...ev].reverse().find(eConversa);
      const semConversa = !ultimaConversa || agora.getTime() - ultimaConversa.ocorreuEm.getTime() > SIMULACAO_SEM_SEGUIMENTO_DIAS * DIA;
      if (semConversa) {
        const desde = ultimaConversa ? ultimaConversa.ocorreuEm : (l.passoDesde ?? l.criadaEm);
        out.push({ ...base, tipo: "simulacao_sem_seguimento", desde: desde.toISOString(), fazer: "Ligar e reforçar a poupança. Há mais de 5 dias sem conversa." });
      }
    }

    if (l.passo === "Não ata nem desata" && dias > NAO_ATA_DIAS) {
      out.push({ ...base, tipo: "nao_ata", desde: (l.passoDesde ?? l.criadaEm).toISOString(), fazer: `Neste passo há ${dias} dias. Decidir: proposta ou perdida.` });
    }

    let tentativas = 0;
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i];
      if (eConversa(e)) break;
      if (eTentativa(e)) tentativas++;
    }
    if (tentativas >= TENTATIVAS_ALERTA) {
      out.push({ ...base, tipo: "tentativas", desde: hoje, fazer: `${tentativas} tentativas sem resposta seguidas. Tentar outra hora, SMS ou WhatsApp, ou fechar.` });
    }
  }

  const ag = agendaComEstado(agendaRecente, eventos, agora);
  for (const a of ag) {
    if (a.estado !== "nao_feito") continue;
    const l = porId.get(a.leadId);
    if (!l || !aberta(l)) continue;
    out.push({
      tipo: "acao_falhada",
      leadId: l.id,
      titulo: l.titulo,
      passo: l.passo,
      userId: a.userId ?? l.userId,
      desde: `${a.dia}${a.hora ? ` ${a.hora}` : ""}`,
      fazer: "A ação marcada não aconteceu. Fazer hoje ou remarcar.",
    });
  }

  return out.sort((x, y) => ORDEM.indexOf(x.tipo) - ORDEM.indexOf(y.tipo));
}

// ---------------------------------------------------------------- resumo

export interface PessoaResumo {
  userId: number | null;
  carteira: number;
  previsto: number;
  feito: number;
  tentou: number;
  naoFeito: number;
  atrasadas: number;
  vendas: number;
  premio: number;
  conversas: number;
  tentativas: number;
}

export interface Resumo {
  de: string;
  ate: string;
  leadsNovas: number;
  primeiroContacto: { noPrazo: number; avaliadas: number };
  simulacoes: number;
  propostas: number;
  vendas: number;
  premio: number;
  perdidas: number;
  previsto: number;
  feito: number;
  atrasadas: number;
  pessoas: PessoaResumo[];
  dias: { dia: string; previsto: number; feito: number; futuro: boolean }[];
  funil: { passo: string; total: number; paradas: number }[];
  motivosPerda: { motivo: string; n: number }[];
  origens: { origem: string; fechadas: number; ganhas: number }[];
}

function noPeriodo(d: Date | null, de: string, ate: string): boolean {
  if (!d) return false;
  const dia = toLisbonDate(d);
  return dia >= de && dia <= ate;
}

export function diasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate && out.length < 400; d = somarDias(d, 1)) out.push(d);
  return out;
}

export function calcularResumo(params: {
  de: string;
  ate: string;
  leads: LeadR[];
  eventos: EventoR[];
  agenda: AgendaR[];
  categoriaDe: Map<string, string | null>;
  agora: Date;
}): Resumo {
  const { de, ate, leads, eventos, agenda, categoriaDe, agora } = params;
  const hoje = toLisbonDate(agora);
  const m = porLead(eventos);
  const pessoas = new Map<number | null, PessoaResumo>();
  const pessoa = (id: number | null): PessoaResumo => {
    let p = pessoas.get(id);
    if (!p) {
      p = { userId: id, carteira: 0, previsto: 0, feito: 0, tentou: 0, naoFeito: 0, atrasadas: 0, vendas: 0, premio: 0, conversas: 0, tentativas: 0 };
      pessoas.set(id, p);
    }
    return p;
  };

  let leadsNovas = 0, noPrazo = 0, avaliadas = 0, vendas = 0, premio = 0, perdidas = 0, atrasadasTot = 0;
  const funil = new Map<string, { total: number; paradas: number }>();
  const motivos = new Map<string, number>();
  const origens = new Map<string, { fechadas: number; ganhas: number }>();

  for (const l of leads) {
    if (aberta(l)) {
      const p = pessoa(l.userId);
      p.carteira++;
      if (atrasada(l, hoje)) {
        p.atrasadas++;
        atrasadasTot++;
      }
      const passo = l.passo ?? "Sem passo";
      const f = funil.get(passo) ?? { total: 0, paradas: 0 };
      f.total++;
      if (parada(l, agora)) f.paradas++;
      funil.set(passo, f);
    }

    if (noPeriodo(l.criadaEm, de, ate)) {
      leadsNovas++;
      if (agora.getTime() - l.criadaEm.getTime() > PRIMEIRO_CONTACTO_HORAS * HORA) {
        avaliadas++;
        const limite = l.criadaEm.getTime() + PRIMEIRO_CONTACTO_HORAS * HORA;
        const ev = m.get(l.id) ?? [];
        if (ev.some((e) => eContacto(e) && e.ocorreuEm >= l.criadaEm && e.ocorreuEm.getTime() <= limite)) noPrazo++;
      }
    }

    if ((l.estado === "won" || l.estado === "lost") && noPeriodo(l.fechadaEm, de, ate)) {
      const origem = l.origem ?? "Sem origem";
      const o = origens.get(origem) ?? { fechadas: 0, ganhas: 0 };
      o.fechadas++;
      if (l.estado === "won") {
        o.ganhas++;
        vendas++;
        premio += l.valor ?? 0;
        const p = pessoa(l.userId);
        p.vendas++;
        p.premio += l.valor ?? 0;
      } else {
        perdidas++;
        const motivo = l.tags.find((t) => categoriaDe.get(t) === "Motivo Perdido") ?? "Sem motivo marcado";
        motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
      }
      origens.set(origem, o);
    }
  }

  let simulacoes = 0, propostas = 0;
  for (const e of eventos) {
    if (!noPeriodo(e.ocorreuEm, de, ate)) continue;
    if (e.tipo === "passo" && e.valor === "Simulação enviada") simulacoes++;
    if (e.tipo === "passo" && e.valor === "Proposta enviada") propostas++;
    if (e.tipo === "chamada" && e.userId != null) {
      if (eConversa(e)) pessoa(e.userId).conversas++;
      else if (eTentativa(e)) pessoa(e.userId).tentativas++;
    }
  }

  const doPeriodo = agenda.filter((a) => a.dia >= de && a.dia <= ate);
  const ag = agendaComEstado(doPeriodo, eventos, agora);
  const porDia = new Map<string, { previsto: number; feito: number }>();
  let previsto = 0, feito = 0;
  for (const a of ag) {
    const p = pessoa(a.userId);
    p.previsto++;
    previsto++;
    const d = porDia.get(a.dia) ?? { previsto: 0, feito: 0 };
    d.previsto++;
    if (a.estado === "feito") {
      p.feito++;
      feito++;
      d.feito++;
    } else if (a.estado === "tentou") p.tentou++;
    else if (a.estado === "nao_feito") p.naoFeito++;
    porDia.set(a.dia, d);
  }

  const dias = diasEntre(de, ate)
    .filter((d) => {
      const s = new Date(`${d}T12:00:00Z`).getUTCDay();
      return s !== 0 && s !== 6;
    })
    .map((d) => ({ dia: d, previsto: porDia.get(d)?.previsto ?? 0, feito: porDia.get(d)?.feito ?? 0, futuro: d > hoje }));

  const ordemPasso = (p: string): number => {
    const i = (PASSOS as readonly string[]).indexOf(p);
    return i < 0 ? 99 : i;
  };

  return {
    de,
    ate,
    leadsNovas,
    primeiroContacto: { noPrazo, avaliadas },
    simulacoes,
    propostas,
    vendas,
    premio: Math.round(premio * 100) / 100,
    perdidas,
    previsto,
    feito,
    atrasadas: atrasadasTot,
    pessoas: [...pessoas.values()].map((p) => ({ ...p, premio: Math.round(p.premio * 100) / 100 })),
    dias,
    funil: [...funil.entries()].map(([passo, f]) => ({ passo, ...f })).sort((a, b) => ordemPasso(a.passo) - ordemPasso(b.passo)),
    motivosPerda: [...motivos.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
    origens: [...origens.entries()].map(([origem, o]) => ({ origem, ...o })).sort((a, b) => b.fechadas - a.fechadas),
  };
}
