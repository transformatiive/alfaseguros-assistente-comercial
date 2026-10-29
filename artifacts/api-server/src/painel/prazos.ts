import {
  diaDaSemana,
  lisbonInstant,
  somarDias,
  somarDiasUteis,
  toLisbonDate,
} from "../lib/dates.js";

/**
 * When a task is due, and — always — *why* that is the date.
 *
 * The panel used to invent this. `follow_up_sla_hours` was the constant 24 for
 * everybody, and `RISCO_THRESHOLD_HOURS` was the constant 24 for every Desk
 * ticket, so the deadline column said the same thing about a quote promised
 * for six o'clock and a partnership form that has sat unread for three weeks.
 *
 * Meanwhile the promise itself usually contains the answer. The model writes
 * *"Confirmar até ao final do dia 03/09"*, *"contactar a cliente até
 * segunda-feira de manhã, conforme prometido"*, *"dentro de 2 a 3 dias
 * úteis"*. Throwing that sentence away and substituting a constant is not a
 * simplification, it is a wrong answer: a deadline that is not the deadline
 * teaches the agent to ignore the column, and then the real ones go unread
 * too.
 *
 * So there are two paths and the card always says which one it took:
 *
 *   `prometido` — a date read out of the promise or the ticket thread. The
 *                 agent said it to the customer; it is not ours to move.
 *   `inferido`  — nothing was said, so the date comes from what kind of work
 *                 this is and how long it has been sitting.
 *
 * Deliberately free of an LLM. Every expression below appears verbatim in real
 * follow-ups, a regex reads them for nothing, and a deadline that costs a
 * model call cannot be recomputed every fifteen minutes.
 */

export type OrigemPrazo = "prometido" | "inferido";

/**
 * Que parte de `quando` foi mesmo dita.
 *
 *   `combinada` — houve uma hora: "até às 21h".
 *   `manha`     — "de manhã": guardado como 12:00.
 *   `dia`       — só o dia, ou nada: guardado como 18:00, que é o fim do dia
 *                 de trabalho, e **mostrado como "fim do dia"**. Seis tarefas
 *                 "às 18:00" liam-se como seis horas combinadas com seis
 *                 clientes, e nenhuma o era.
 */
export type HoraDoPrazo = "combinada" | "manha" | "dia";

export interface Prazo {
  /** ISO instant. */
  quando: string;
  origem: OrigemPrazo;
  hora: HoraDoPrazo;
  /** One line, printed under the date: "prometeste na chamada de 03/09". */
  porque: string;
}

/** End of the working day, in Lisbon wall-clock hours. */
const FIM_DO_DIA = 18;
/** "de manhã" — before lunch, so noon is the honest reading. */
const FIM_DA_MANHA = 12;

/* ── Ler uma data escrita ───────────────────────────────────────────────── */

interface Achado {
  /** Where in the text it was found. The earliest wins. */
  indice: number;
  /** How long the match was. Longer wins a tie, so the specific beats the vague. */
  comprimento: number;
  quando: Date;
  hora: HoraDoPrazo;
}

const DIAS_DA_SEMANA: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  terça: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
};

/** The next occurrence of `alvo` strictly after `dia`. Today never counts. */
function proximoDiaDaSemana(dia: string, alvo: number): string {
  let d = somarDias(dia, 1);
  for (let i = 0; i < 7 && diaDaSemana(d) !== alvo; i++) d = somarDias(d, 1);
  return d;
}

/** The Friday of the week `dia` falls in — or the next one if it has passed. */
function sextaDaSemana(dia: string): string {
  const w = diaDaSemana(dia);
  if (w === 5) return dia;
  if (w === 6 || w === 0) return proximoDiaDaSemana(dia, 5);
  return somarDias(dia, 5 - w);
}

function anoDe(dia: string): number {
  return Number(dia.slice(0, 4));
}

/**
 * A `DD/MM` written by the model, resolved against the day it was written.
 *
 * The year is almost never written. Assuming the reference year is right
 * except across the turn: a promise made on 28 December that says "até 03/01"
 * means January, so a resolved date more than six months *before* the
 * reference rolls forward a year.
 */
function dataCurta(dia: string, d: number, m: number, ano?: number): string | null {
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  let y = ano ?? anoDe(dia);
  if (ano != null && ano < 100) y = 2000 + ano;
  const candidato = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (ano == null) {
    const distancia = Date.parse(`${candidato}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`);
    if (distancia < -182 * 86_400_000) {
      return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return candidato;
}

type Regra = {
  re: RegExp;
  /** Só no texto da promessa, e só depois de um verbo de ação na mesma frase. */
  soNaPromessa?: boolean;
  ler: (m: RegExpExecArray, dia: string) => Date | null;
  /** Que parte da hora o texto diz. Sem isto, só o dia. */
  hora?: (m: RegExpExecArray) => HoraDoPrazo;
};

/**
 * The expressions, each anchored on a cue word.
 *
 * The anchor is what makes this safe. A bare `\d{1,2}/\d{1,2}` would read the
 * "33-OI-45" in a ticket subject as a date; requiring "até", "dentro de" or
 * "no prazo de" in front means the text has to be *stating a deadline* before
 * anything is read out of it.
 */
const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
const MES_RE = "(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";

/** O último dia do mês `m` (1-12): deste ano, ou do próximo se já passou. */
function ultimoDiaDoMes(dia: string, m: number): string | null {
  if (m < 1 || m > 12) return null;
  const ultimoDe = (y: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const y = anoDe(dia);
  const este = ultimoDe(y);
  return este < dia ? ultimoDe(y + 1) : este;
}

/**
 * Verbos que dizem que a frase é uma ação nossa. As regras das datas
 * marcadas pelo cliente só valem quando um destes aparece antes da data, na
 * mesma frase: "Contactar o Sr. Costa a partir de 17/11" sim, "O seguro
 * começa a partir de 01/01" não.
 */
const ACAO_ANTES =
  /\b(?:contactar|ligar|telefonar|voltar\s+a|enviar|reenviar|confirmar|agendar|marcar|falar|responder|remeter|enviar|recolher|preparar|acompanhar|verificar|tratar|reunir|devolver|retomar|rever|apresentar|fechar|emitir|pedir|solicitar|lembrar|relembrar)\b/i;

/**
 * O que vem antes da posição `indice`, desde o início da frase. Um ponto a
 * seguir a uma palavra curta ("Sr.", "Dra.", "n.") é uma abreviatura, não o
 * fim da frase.
 */
function fraseAte(texto: string, indice: number): string {
  const antes = texto.slice(0, indice);
  let corte = -1;
  for (const m of antes.matchAll(/[.;!?\n]/g)) {
    const i = m.index ?? 0;
    if (m[0] === ".") {
      const palavra = /([\p{L}]+)$/u.exec(antes.slice(0, i))?.[1] ?? "";
      if (palavra.length > 0 && palavra.length <= 3) continue;
    }
    corte = i;
  }
  return antes.slice(corte + 1);
}

const REGRAS: Regra[] = [
  // "até ao final do dia 03/09"
  {
    re: /at[ée]\s+(?:ao\s+)?final\s+d[oe]\s+dia\s+(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/gi,
    ler: (m, dia) => {
      const d = dataCurta(dia, +m[1], +m[2], m[3] ? +m[3] : undefined);
      return d ? lisbonInstant(d, FIM_DO_DIA) : null;
    },
  },
  // "até ao final do dia" / "até ao final do próprio dia"
  {
    re: /at[ée]\s+(?:ao\s+)?final\s+d[oe]\s+(?:pr[óo]prio\s+)?dia\b(?!\s+\d)/gi,
    ler: (_m, dia) => lisbonInstant(dia, FIM_DO_DIA),
  },
  // "até às 21h", "até às 18:30"
  {
    re: /at[ée]\s+[àa]s?\s+(\d{1,2})(?:[h:](\d{2}))?\s*h?(?:oras)?\b/gi,
    hora: () => "combinada",
    ler: (m, dia) => {
      const h = +m[1];
      if (h > 23) return null;
      return lisbonInstant(dia, h, m[2] ? +m[2] : 0);
    },
  },
  // "até ao dia 04/09", "até 04/09"
  {
    re: /at[ée]\s+(?:ao\s+dia\s+)?(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/gi,
    ler: (m, dia) => {
      const d = dataCurta(dia, +m[1], +m[2], m[3] ? +m[3] : undefined);
      return d ? lisbonInstant(d, FIM_DO_DIA) : null;
    },
  },
  // "até quinta-feira", "até segunda-feira de manhã"
  {
    re: /at[ée]\s+(?:[àa]\s+)?(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado)(?:[-\s]feira)?(\s+de\s+manh[ãa])?/gi,
    hora: (m) => (m[2] ? "manha" : "dia"),
    ler: (m, dia) => {
      const alvo = DIAS_DA_SEMANA[m[1].toLowerCase()];
      if (alvo === undefined) return null;
      return lisbonInstant(proximoDiaDaSemana(dia, alvo), m[2] ? FIM_DA_MANHA : FIM_DO_DIA);
    },
  },
  // "até ao final da semana" / "até ao final da próxima semana"
  {
    re: /at[ée]\s+(?:ao\s+)?final\s+da\s+(pr[óo]xima\s+)?semana/gi,
    ler: (m, dia) => {
      const base = m[1] ? somarDias(dia, 7) : dia;
      return lisbonInstant(sextaDaSemana(base), FIM_DO_DIA);
    },
  },
  // "nos primeiros dias da semana seguinte" / "até ao início da próxima semana"
  {
    re: /(?:nos\s+primeiros\s+dias\s+da\s+semana\s+seguinte|at[ée]\s+(?:ao\s+)?in[íi]cio\s+da\s+pr[óo]xima\s+semana)/gi,
    ler: (_m, dia) => lisbonInstant(proximoDiaDaSemana(sextaDaSemana(dia), 1), FIM_DO_DIA),
  },
  // "até amanhã"
  {
    re: /at[ée]\s+amanh[ãa]/gi,
    ler: (_m, dia) => lisbonInstant(somarDias(dia, 1), FIM_DO_DIA),
  },
  // "ainda hoje", "ainda no mesmo dia", "do próprio dia"
  {
    re: /(?:ainda\s+(?:hoje|no\s+mesmo\s+dia)|no\s+mesmo\s+dia|d[oe]\s+pr[óo]prio\s+dia)/gi,
    ler: (_m, dia) => lisbonInstant(dia, FIM_DO_DIA),
  },
  // "dentro de 2 a 3 dias úteis" — the far end of a range is the promise.
  {
    re: /dentro\s+de\s+(\d{1,2})(?:\s*a\s*(\d{1,2}))?\s+dias?\s+[úu]teis/gi,
    ler: (m, dia) => lisbonInstant(somarDiasUteis(dia, +(m[2] ?? m[1])), FIM_DO_DIA),
  },
  // "dentro de 7 a 10 dias", "nos próximos 5 dias"
  {
    re: /(?:dentro\s+de|nos\s+pr[óo]ximos)\s+(\d{1,2})(?:\s*a\s*(\d{1,2}))?\s+dias?\b/gi,
    ler: (m, dia) => lisbonInstant(somarDias(dia, +(m[2] ?? m[1])), FIM_DO_DIA),
  },
  // "no prazo de 48 horas" / "no prazo de 5 dias úteis"
  {
    re: /no\s+prazo\s+de\s+(\d{1,3})\s+(horas?|dias?)(\s+[úu]teis)?/gi,
    ler: (m, dia) => {
      const n = +m[1];
      if (/hora/i.test(m[2])) return lisbonInstant(dia, FIM_DO_DIA + Math.min(n, 6));
      return lisbonInstant(m[3] ? somarDiasUteis(dia, n) : somarDias(dia, n), FIM_DO_DIA);
    },
  },

  // As datas que o cliente marca. "a partir de 17 de novembro" quer dizer que
  // antes disso não há nada a fazer: o prazo é esse dia, e até lá a linha não
  // está em atraso (o #178260 do Tiago aparecia com 29 dias de atraso).
  //
  // Estas regras só se leem no texto da promessa, e só quando a frase pede
  // uma ação nossa antes da data ("Contactar … a partir de 17/11"). Numa
  // mensagem de ticket, ou numa frase que conta o que aconteceu ("No dia 03/09
  // o cliente ligou", "o seguro começa a partir de 01/01"), estas palavras
  // descrevem o passado ou o início de uma apólice, e não um prazo.

  // "a partir de 17 de novembro", "até 3 de outubro", "no dia 5 de dezembro de 2026"
  {
    soNaPromessa: true,
    re: new RegExp(
      `(?:at[ée]|a\\s+partir\\s+d[eo]|depois\\s+d[eo]|ap[óo]s|no\\s+dia|para\\s+o\\s+dia)\\s+(?:(?:o|ao)\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+${MES_RE}(?:\\s+de\\s+(\\d{4}))?`,
      "gi",
    ),
    ler: (m, dia) => {
      const mes = MESES[m[2].toLowerCase()];
      if (!mes) return null;
      const d = dataCurta(dia, +m[1], mes, m[3] ? +m[3] : undefined);
      return d ? lisbonInstant(d, FIM_DO_DIA) : null;
    },
  },
  // "a partir de 17/11", "depois do dia 17/11", "no dia 17/11". Só com "/":
  // "depois de 1.5 anos" e "após 2/3 dias" não são datas.
  {
    soNaPromessa: true,
    re: /(?:a\s+partir\s+d[eo]|depois\s+d[eo]|ap[óo]s|no\s+dia|para\s+o\s+dia)\s+(?:(?:o|ao)\s+)?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d|\s*(?:dias?|horas?|anos?|meses|m[êe]s|semanas?)\b)/gi,
    ler: (m, dia) => {
      const d = dataCurta(dia, +m[1], +m[2], m[3] ? +m[3] : undefined);
      return d ? lisbonInstant(d, FIM_DO_DIA) : null;
    },
  },
  // "na quarta-feira às 15h30", "na segunda-feira de manhã", "no sábado".
  // Pede "-feira" nos dias úteis ("na segunda chamada" não é uma data) e
  // "às"/"as" com o s ("a 5 de novembro" não é uma hora).
  {
    soNaPromessa: true,
    re: /\b(?:na|no)\s+(?:pr[óo]xim[ao]\s+)?(?:(segunda|ter[cç]a|quarta|quinta|sexta)[-\s]feira|(s[áa]bado|domingo))(?!\s+(?:passad|anterior))(\s+de\s+manh[ãa])?(?:\s+[àa]s\s+(\d{1,2})(?:[h:]([0-5]\d))?\s*h?)?/gi,
    hora: (m) => (m[4] ? "combinada" : m[3] ? "manha" : "dia"),
    ler: (m, dia) => {
      const alvo = DIAS_DA_SEMANA[(m[1] ?? m[2]).toLowerCase()];
      if (alvo === undefined) return null;
      const d = proximoDiaDaSemana(dia, alvo);
      if (m[4]) {
        const h = +m[4];
        if (h > 23) return null;
        return lisbonInstant(d, h, m[5] ? +m[5] : 0);
      }
      return lisbonInstant(d, m[3] ? FIM_DA_MANHA : FIM_DO_DIA);
    },
  },
  // "na próxima semana", "na semana seguinte"
  {
    soNaPromessa: true,
    re: /(?:na\s+pr[óo]xima\s+semana|na\s+semana\s+seguinte)/gi,
    ler: (_m, dia) => lisbonInstant(sextaDaSemana(somarDias(dia, 7)), FIM_DO_DIA),
  },
  // "até ao final do mês", "antes do final de outubro", "até ao fim do mês de novembro"
  {
    soNaPromessa: true,
    re: new RegExp(
      `(?:at[ée]|antes)\\s+(?:(?:ao|do|da|o|a)\\s+)?(?:final|fim)\\s+d[oe]\\s+(?:m[êe]s\\s+de\\s+${MES_RE}|${MES_RE}|(m[êe]s))`,
      "gi",
    ),
    ler: (m, dia) => {
      const nome = m[1] ?? m[2];
      const mes = nome ? MESES[nome.toLowerCase()] : Number(dia.slice(5, 7));
      if (!mes) return null;
      const d = ultimoDiaDoMes(dia, mes);
      return d ? lisbonInstant(d, FIM_DO_DIA) : null;
    },
  },
];

/**
 * The deadline written in `texto`, read against the day it was written.
 *
 * Earliest match wins, because a follow-up that says two things — *"Confirmar
 * até ao final do dia 03/09; caso não chegue, contactar novamente até 04/09"*
 * — states the deadline first and the fallback second. Length breaks a tie so
 * that "até ao final do dia 03/09" beats the "até ao final do dia" hiding
 * inside it.
 */
export function lerPrazoEscrito(
  texto: string | null | undefined,
  referencia: Date,
  opcoes: { promessa?: boolean } = {},
): Date | null {
  return lerPrazoComHora(texto, referencia, opcoes)?.quando ?? null;
}

/** O mesmo que `lerPrazoEscrito`, dizendo também se havia hora. */
export function lerPrazoComHora(
  texto: string | null | undefined,
  referencia: Date,
  opcoes: { promessa?: boolean } = {},
): { quando: Date; hora: HoraDoPrazo } | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const dia = toLisbonDate(referencia);

  let melhor: Achado | null = null;
  for (const regra of REGRAS) {
    if (regra.soNaPromessa && !opcoes.promessa) continue;
    regra.re.lastIndex = 0;
    let m = regra.re.exec(t);
    // A primeira ocorrência numa frase sem verbo de ação não conta, mas a
    // seguinte pode contar.
    while (m && regra.soNaPromessa && !ACAO_ANTES.test(fraseAte(t, m.index))) m = regra.re.exec(t);
    if (!m) continue;
    const quando = regra.ler(m, dia);
    if (!quando || Number.isNaN(quando.getTime())) continue;
    const achado = {
      indice: m.index,
      comprimento: m[0].length,
      quando,
      hora: regra.hora?.(m) ?? "dia",
    };
    if (
      !melhor ||
      achado.indice < melhor.indice ||
      (achado.indice === melhor.indice && achado.comprimento > melhor.comprimento)
    ) {
      melhor = achado;
    }
  }
  return melhor ? { quando: melhor.quando, hora: melhor.hora } : null;
}

/* ── Inferir quando nada foi dito ───────────────────────────────────────── */

/**
 * What kind of waiting this is — which is what sets the clock when nobody
 * wrote a date down.
 *
 * These are not arbitrary. They are the shape of the work: a first reply is
 * owed within the day, a quote that was asked for has a couple of working days
 * before the customer starts shopping elsewhere, a quote already sent goes
 * cold in about a week, and a ticket genuinely parked on the customer is not
 * ours to chase until a fortnight has gone by.
 */
export type TipoDeEspera =
  | "primeira_resposta"
  | "simulacao_pedida"
  | "follow_up_simulacao"
  | "compromisso"
  | "espera_cliente";

const DIAS_POR_TIPO: Record<TipoDeEspera, { dias: number; uteis: boolean; porque: string }> = {
  primeira_resposta: { dias: 1, uteis: true, porque: "primeira resposta em 24 h" },
  simulacao_pedida: { dias: 2, uteis: true, porque: "simulação pedida — 2 dias úteis" },
  follow_up_simulacao: { dias: 5, uteis: false, porque: "simulação enviada — seguir ao 5.º dia" },
  // One working day, not two: 24 hours is the SLA the team actually works to
  // (it is what `follow_up_sla_hours` reports to n8n, and what HANDOVER calls
  // the house rule). The old code was wrong to apply it to *everything*; it is
  // not wrong for the case it was written for — a promise with no date on it.
  compromisso: { dias: 1, uteis: true, porque: "compromisso sem data — 24 h" },
  espera_cliente: { dias: 14, uteis: false, porque: "à espera do cliente — relembrar aos 14 dias" },
};

export function prazoInferido(tipo: TipoDeEspera, desde: Date): { quando: Date; porque: string } {
  const regra = DIAS_POR_TIPO[tipo];
  const dia = toLisbonDate(desde);
  const alvo = regra.uteis ? somarDiasUteis(dia, regra.dias) : somarDias(dia, regra.dias);
  return { quando: lisbonInstant(alvo, FIM_DO_DIA), porque: regra.porque };
}

/* ── A decisão ──────────────────────────────────────────────────────────── */

export interface PedidoDePrazo {
  /** The promise, or the ticket thread. Where a date might be written. */
  texto?: string | null;
  /** `texto` é o que o agente prometeu na chamada, e não o assunto de um ticket. */
  textoEPromessa?: boolean;
  /**
   * Mensagens do ticket, cada uma com o dia em que foi escrita, a mais
   * recente primeiro. Lidas antes de `texto`: o que ficou combinado por
   * último é o que vale, e "até amanhã" conta do dia da mensagem.
   */
  mensagens?: readonly { texto: string; quando: Date }[];
  /** The day that text was written — what "quinta-feira" is relative to. */
  referencia: Date;
  /** When the obligation started. What an inferred deadline counts from. */
  desde: Date;
  tipo: TipoDeEspera;
  agora: Date;
}

/** How many whole days ago, for the "13 dias sem resposta" wording. */
function diasDesde(desde: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 86_400_000));
}

export function derivarPrazo(p: PedidoDePrazo): Prazo {
  for (const msg of p.mensagens ?? []) {
    const escrito = lerPrazoComHora(msg.texto, msg.quando);
    if (!escrito) continue;
    return {
      quando: escrito.quando.toISOString(),
      origem: "prometido",
      hora: escrito.hora,
      porque: `combinado no ticket a ${diaCurtoDe(msg.quando)}`,
    };
  }

  const escrito = lerPrazoComHora(p.texto, p.referencia, { promessa: p.textoEPromessa });
  if (escrito) {
    return {
      quando: escrito.quando.toISOString(),
      origem: "prometido",
      hora: escrito.hora,
      porque: `prometido na conversa de ${diaCurtoDe(p.referencia)}`,
    };
  }

  const { quando, porque } = prazoInferido(p.tipo, p.desde);
  const dias = diasDesde(p.desde, p.agora);
  // Once it is late, how long it has been sitting says more than the rule
  // that set the date — that is the number the agent is actually judging.
  const razao =
    quando < p.agora && dias >= 2 ? `${dias} dias sem resposta` : porque;
  return { quando: quando.toISOString(), origem: "inferido", hora: "dia", porque: razao };
}

/** "03/09", em Lisboa. */
function diaCurtoDe(d: Date): string {
  return toLisbonDate(d).split("-").reverse().slice(0, 2).join("/");
}
