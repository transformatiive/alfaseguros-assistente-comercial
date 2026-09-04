import type { TicketEmRisco } from "./tipos";

/**
 * Grouping Desk tickets by status, ordered by whose move it is.
 *
 * A flat list of 72 tickets is not information, it is a wall. Sorted by age it
 * is still a wall, just a tidier one — the oldest ticket may be one that is
 * legitimately parked waiting for an insurer, while the thing that actually
 * needs the agent is a `Novo` from yesterday buried at row forty.
 *
 * So the order is not alphabetical and not by count. It is: **can I act on
 * this right now?** Everything where the ball is in the agent's court comes
 * first; everything waiting on somebody else sinks, because an agent scanning
 * their morning should not have to read past work they cannot do.
 *
 * Statuses are Desk's own free text and the list below was taken from real
 * data. An unknown one is not dropped — it lands just before the waiting
 * group, visible and clearly unclassified, because a status nobody mapped is
 * more likely to need attention than less.
 */

export interface GrupoDeEstado {
  estado: string;
  tickets: TicketEmRisco[];
  /** Whether the agent can act now. Drives colour and default expansion. */
  agir: boolean;
  cor: string;
}

/**
 * Ordered by urgency. Lower index = earlier on screen.
 * `agir: false` means the ticket is parked on somebody else's decision.
 */
const ORDEM: Array<{ estado: string; agir: boolean; cor: string }> = [
  // Nobody has touched these. On a real day this is the biggest group and the
  // whole reason the block exists.
  { estado: "Novo", agir: true, cor: "text-red-700" },
  { estado: "Chamada Perdida", agir: true, cor: "text-red-700" },
  { estado: "Fazer Simulação", agir: true, cor: "text-amber-700" },
  { estado: "Requer Validação", agir: true, cor: "text-amber-700" },
  { estado: "Aberto", agir: true, cor: "text-amber-700" },
  { estado: "Espera Follow Up", agir: true, cor: "text-blue-700" },
  // Parked on someone else. Still shown — a customer who never replies is the
  // agent's problem eventually — but never above work they can do today.
  { estado: "Espera Cliente", agir: false, cor: "text-stone-500" },
  { estado: "Espera Companhia", agir: false, cor: "text-stone-500" },
];

const POSICAO = new Map(ORDEM.map((o, i) => [o.estado, i]));
/** Unknown statuses sit just before the waiting group. */
const POSICAO_DESCONHECIDO = ORDEM.findIndex((o) => !o.agir) - 0.5;

export function agruparPorEstado(tickets: readonly TicketEmRisco[]): GrupoDeEstado[] {
  const porEstado = new Map<string, TicketEmRisco[]>();
  for (const t of tickets) {
    const estado = t.status?.trim() || "Sem estado";
    porEstado.set(estado, [...(porEstado.get(estado) ?? []), t]);
  }

  const grupos: Array<GrupoDeEstado & { ordem: number }> = [];
  for (const [estado, lista] of porEstado) {
    const conhecido = ORDEM.find((o) => o.estado === estado);
    grupos.push({
      estado,
      // Oldest first inside a group: within one kind of work, waiting longest
      // is the only ranking that matters.
      tickets: [...lista].sort((a, b) => b.idadeHoras - a.idadeHoras),
      agir: conhecido?.agir ?? true,
      cor: conhecido?.cor ?? "text-stone-600",
      ordem: POSICAO.get(estado) ?? POSICAO_DESCONHECIDO,
    });
  }

  grupos.sort((a, b) => a.ordem - b.ordem || b.tickets.length - a.tickets.length);
  return grupos.map(({ ordem: _ordem, ...g }) => g);
}
