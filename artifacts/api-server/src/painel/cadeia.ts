/**
 * Where a piece of business is in the chain, and which link is missing.
 *
 * Almost every conversation here runs the same three steps: the customer
 * **asks**, we **send a quote**, we **follow up** on it. The panel used to
 * show rows from four data sources and left the agent to work out, in their
 * head, which step each row was actually at — which is why a quote sent
 * fifteen days ago and never chased looked exactly like a quote requested this
 * morning.
 *
 * The missing link *is* the task. Nothing else on the row is the task: the
 * ticket is where it lives, the promise is what was said, the deadline is when
 * — but the thing to do is the first step that has not happened.
 *
 * Pure, and deliberately ignorant of where the signals came from. Whether a
 * quote went out is answered by a Desk comment or by a call transcript; this
 * module is handed the answer, not the sources.
 */

export type NomeDoPasso = "pedido" | "simulacao" | "follow_up";
export type EstadoDoPasso = "feito" | "em_falta" | "nao_aplicavel";

export interface Passo {
  passo: NomeDoPasso;
  estado: EstadoDoPasso;
  /** ISO instant of when it happened. Null unless `feito`. */
  quando: string | null;
}

export interface Cadeia {
  passos: Passo[];
  /** The first step not done — the task itself. Null when nothing is owed. */
  emFalta: NomeDoPasso | null;
}

export interface SinaisDaCadeia {
  /** When the customer asked. A ticket's creation, or the call. */
  pedidoEm: string | null;
  /** Whether this is a quote at all. A claim or a policy change is not. */
  envolveSimulacao: boolean;
  /** When the quote went out, if it did. */
  simulacaoEnviadaEm: string | null;
  /** Our last outbound move — an agent's reply or an answered call. */
  ultimoContactoNosso: string | null;
}

const ORDEM: NomeDoPasso[] = ["pedido", "simulacao", "follow_up"];

function depoisDe(instante: string | null, marco: string | null): boolean {
  if (!instante || !marco) return false;
  return Date.parse(instante) > Date.parse(marco);
}

export function derivarCadeia(s: SinaisDaCadeia): Cadeia {
  const pedido: Passo = s.pedidoEm
    ? { passo: "pedido", estado: "feito", quando: s.pedidoEm }
    : // No record of a request is not "the customer never asked" — it is a row
      // we cannot reason about. Marking it done would invent the first link.
      { passo: "pedido", estado: "nao_aplicavel", quando: null };

  const simulacao: Passo = !s.envolveSimulacao
    ? { passo: "simulacao", estado: "nao_aplicavel", quando: null }
    : s.simulacaoEnviadaEm
      ? { passo: "simulacao", estado: "feito", quando: s.simulacaoEnviadaEm }
      : { passo: "simulacao", estado: "em_falta", quando: null };

  // A follow-up only exists once there is something to follow up on. Chasing a
  // quote that was never sent is not a follow-up, it is the quote — and
  // showing both would put the same job on the list twice.
  const podeSeguir = simulacao.estado === "feito";
  const seguiu = podeSeguir && depoisDe(s.ultimoContactoNosso, s.simulacaoEnviadaEm);
  const followUp: Passo = !podeSeguir
    ? { passo: "follow_up", estado: "nao_aplicavel", quando: null }
    : seguiu
      ? { passo: "follow_up", estado: "feito", quando: s.ultimoContactoNosso }
      : { passo: "follow_up", estado: "em_falta", quando: null };

  const passos = [pedido, simulacao, followUp];
  const emFalta =
    ORDEM.find((n) => passos.find((p) => p.passo === n)?.estado === "em_falta") ?? null;

  return { passos, emFalta };
}
