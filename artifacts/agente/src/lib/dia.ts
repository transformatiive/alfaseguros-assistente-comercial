/**
 * Which day the panel is showing.
 *
 * Normally today, in Lisbon, decided by the server. `?data=YYYY-MM-DD` overrides
 * it — needed to look at a day that already has data before the twice-daily
 * refresh has run for the current one, and useful on a Monday for checking what
 * Saturday left behind.
 *
 * Read from the query string rather than the fragment, because unlike the token
 * this is not a secret and *should* survive a copy-paste of the address.
 */
export function diaPedido(): string | null {
  const bruto = new URLSearchParams(window.location.search).get("data");
  // Validated rather than trusted: the value goes into a request path, and an
  // unvalidated one would produce a confusing 400 instead of a clear fallback.
  return bruto && /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto : null;
}

/** Append `?data=` to an endpoint when a day was asked for. */
export function comDia(caminho: string): string {
  const dia = diaPedido();
  return dia ? `${caminho}?data=${dia}` : caminho;
}
