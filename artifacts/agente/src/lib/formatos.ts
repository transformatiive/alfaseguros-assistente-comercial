/**
 * Formatting that has to be identical everywhere on the panel, so it lives in
 * one place rather than being re-improvised per component.
 */

const HORA = new Intl.DateTimeFormat("pt-PT", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Lisbon",
});

/** `14:32`, always Lisbon — the team's clock, whatever the browser thinks. */
export function hora(iso: string): string {
  return HORA.format(new Date(iso));
}

/**
 * `+351 912 345 678` from `351912345678`.
 *
 * Falls back to the raw string when it does not look Portuguese, rather than
 * mangling it: a number the agent can read and dial matters more than a number
 * that matches a format.
 */
export function telefone(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("351")) {
    const n = d.slice(3);
    return `+351 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return numero;
}

/** `3 dias` / `14 h`. Hours below two days, days after, never both. */
export function idade(horas: number): string {
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

/**
 * Why this call is on your list — shown only when the answer is an inference.
 *
 * `ticket` and `chamada` are facts and need no caption; captioning them would
 * be noise on most rows and would drown the two that matter.
 */
export function porqueMe(origem: string | null): string | null {
  switch (origem) {
    case "grupo":
      return "mesmo cliente, outra tentativa";
    case "historico":
      return "dono do último pedido deste cliente";
    default:
      return null;
  }
}
