import { getAgentUserId, pickCustomerNumber, type RingoverCall } from "@workspace/ringover";
import type { InsertChamadaRingover } from "@workspace/db";
import { toLisbonDate } from "../lib/dates.js";

/**
 * Turn one Ringover call into a `chamadas_ringover` row.
 *
 * Pure on purpose: everything the macro view counts (answered, wait, talk
 * time, hour of day) is decided here, once, at sync time — so the reading
 * side only sums columns and the rules can be tested without a database.
 *
 * Returns null for a call that cannot be placed in time (no start) or has no
 * usable direction. Those are dropped rather than guessed.
 */
export function normalizarChamada(call: RingoverCall): InsertChamadaRingover | null {
  if (!call.start_time) return null;
  const inicio = new Date(call.start_time);
  if (Number.isNaN(inicio.getTime())) return null;

  const direcao = lerDirecao(call.direction);
  if (!direcao) return null;

  const atendida = call.is_answered === true;
  const agente = getAgentUserId(call);

  return {
    cdrId: String(call.cdr_id),
    inicio,
    dia: toLisbonDate(inicio),
    hora: horaLisboa(inicio),
    direcao,
    atendida,
    estado: lerTexto(call["last_state"]),
    duracaoS: atendida ? duracaoConversa(call) : null,
    esperaS: atendida && direcao === "in" ? esperaAteAtender(call, inicio) : null,
    agenteId: agente == null ? null : String(agente),
    agenteNome: nomeAgente(call),
    clienteNumero: pickCustomerNumber(call),
  };
}

function lerDirecao(d: string | undefined): "in" | "out" | null {
  if (d === "in" || d === "inbound") return "in";
  if (d === "out" || d === "outbound") return "out";
  return null;
}

const HORA_LISBOA = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  hour: "2-digit",
  hourCycle: "h23",
});

export function horaLisboa(instant: Date): number {
  return Number(HORA_LISBOA.format(instant));
}

/** Longest plausible wait or call; anything above is a bad record, not a call. */
const MAX_SEGUNDOS = 4 * 3600;

function segundosValidos(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_SEGUNDOS) return null;
  return Math.round(n);
}

function duracaoConversa(call: RingoverCall): number | null {
  return segundosValidos(call.incall_duration) ?? segundosValidos(call.duration);
}

/**
 * Seconds between the call arriving and a person answering. The answered
 * timestamp is the most direct evidence; Ringover's queue / ringing counters
 * are the fallback when it is missing.
 */
function esperaAteAtender(call: RingoverCall, inicio: Date): number | null {
  if (call.answered_time) {
    const atendida = new Date(call.answered_time);
    if (!Number.isNaN(atendida.getTime())) {
      return segundosValidos((atendida.getTime() - inicio.getTime()) / 1000);
    }
  }
  return segundosValidos(call["queue_duration"]) ?? segundosValidos(call["ringing_duration"]);
}

function nomeAgente(call: RingoverCall): string | null {
  const u = call.user;
  if (!u) return null;
  const nome = [u.firstname, u.lastname].filter((p) => typeof p === "string" && p.trim()).join(" ").trim();
  return nome || null;
}

function lerTexto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
