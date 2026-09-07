/**
 * Proof that a task was actually done — the thing that lets a row disappear
 * without anybody clicking anything.
 *
 * The panel's only way to close a task is a button, which is a *declaration*:
 * the agent says it is done. A declaration can be wrong in the direction that
 * hurts — pressing "Devolvida" without having called leaves a customer waiting
 * and no trace of it anywhere. Meanwhile the two systems already know the
 * answer: Ringover knows whether a call happened, Desk knows whether a reply
 * went out.
 *
 * So completion is proven, not declared. Two proofs, and only two:
 *
 *   - an **answered** call to that customer on a day *after* the commitment,
 *     lasting at least `DURACAO_MINIMA_SEG`;
 *   - a comment on the linked ticket, *after* the commitment, written by an
 *     **agent**.
 *
 * ## Both thresholds are the point, not detail
 *
 * A ringing call that goes to voicemail after eight seconds is a record, not a
 * returned call. A Desk "Reminder for your task" is a comment, not a reply.
 * Accepting either would delete a task nobody did — and that error is far
 * worse than the other one. A task left on the list costs a second of the
 * agent's attention; a task wrongly removed costs the customer.
 *
 * So the rule is deliberately conservative and asymmetric: anything uncertain
 * — an unknown duration, an unknown author — is **not** proof, and the task
 * stays.
 */

/**
 * Shorter than this is not a conversation.
 *
 * Alfaseguros' voicemail greeting runs to roughly half a minute, so a
 * "connected" call under about that long is almost always the machine. Forty
 * five seconds clears it with room to spare while still admitting a genuinely
 * brief "sim, recebi, obrigado".
 */
export const DURACAO_MINIMA_SEG = 45;

export interface ChamadaParaEvidencia {
  /** Last nine digits of the customer's number. */
  fingerprint: string;
  /** Lisbon calendar day of the call, `YYYY-MM-DD`. */
  dia: string;
  atendida: boolean;
  duracaoSeg: number | null;
}

export interface RespostaParaEvidencia {
  ticketId: string;
  /** ISO instant. */
  quando: string;
  /** Zoho's `authorType`: AGENT | END_USER | SYSTEM. */
  autorTipo: string | null;
  ticketNumber: string | null;
}

export interface PedidoDeProva {
  /** Lisbon day the obligation was taken on. Same-day activity is the cause,
   *  not the cure, so only *later* days count as proof. */
  diaDoCompromisso: string | null;
  /** ISO instant of the same, for the ticket side, which has real timestamps. */
  desde: string | null;
  fingerprint: string | null;
  ticketId: string | null;
}

export interface Prova {
  tipo: "chamada" | "resposta";
  /** What to print: "chamada atendida de 6 min a 05/09". */
  descricao: string;
}

function minutos(segundos: number): string {
  if (segundos < 90) return `${segundos} s`;
  return `${Math.round(segundos / 60)} min`;
}

function diaCurto(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split("-");
  return `${d}/${m}`;
}

/**
 * The proof, or null.
 *
 * Returns the *first* proof found rather than the best one: the row only needs
 * to know it can go, and the description exists to explain why, not to rank.
 */
export function procurarProva(
  p: PedidoDeProva,
  chamadas: readonly ChamadaParaEvidencia[],
  respostas: readonly RespostaParaEvidencia[],
): Prova | null {
  if (p.fingerprint && p.diaDoCompromisso) {
    for (const c of chamadas) {
      if (c.fingerprint !== p.fingerprint) continue;
      if (c.dia <= p.diaDoCompromisso) continue;
      if (!c.atendida) continue;
      // An unknown duration is not a long call — it is an unknown, and an
      // unknown must not close somebody's task.
      if (c.duracaoSeg == null || c.duracaoSeg < DURACAO_MINIMA_SEG) continue;
      return {
        tipo: "chamada",
        descricao: `chamada atendida de ${minutos(c.duracaoSeg)} a ${diaCurto(c.dia)}`,
      };
    }
  }

  if (p.ticketId && p.desde) {
    const limite = Date.parse(p.desde);
    for (const r of respostas) {
      if (r.ticketId !== p.ticketId) continue;
      if (!(Date.parse(r.quando) > limite)) continue;
      // END_USER is the customer answering us — that is not us doing the work.
      // SYSTEM is Desk talking to itself. Only AGENT is a reply.
      if ((r.autorTipo ?? "").toUpperCase() !== "AGENT") continue;
      const onde = r.ticketNumber ? `no ticket #${r.ticketNumber}` : "no ticket";
      return {
        tipo: "resposta",
        descricao: `resposta enviada ${onde} a ${diaCurto(r.quando.slice(0, 10))}`,
      };
    }
  }

  return null;
}

/**
 * The grey line under a row: what was looked for, and not found.
 *
 * This is the whole argument for the task being on the list, written out. A
 * row that cannot say why it is there is asking to be trusted; a row that says
 * "no answered call since 26/08 and no reply on the ticket" can be checked,
 * and — when it is wrong — corrected.
 */
export function porqueContinuaAberta(p: PedidoDeProva): string | null {
  const partes: string[] = [];
  if (p.fingerprint && p.diaDoCompromisso) {
    partes.push(`sem chamada atendida para este número desde ${diaCurto(p.diaDoCompromisso)}`);
  }
  if (p.ticketId) partes.push("sem resposta tua no ticket");
  if (partes.length === 0) return null;
  const frase = partes.join(" e ");
  return frase.charAt(0).toUpperCase() + frase.slice(1) + ".";
}
