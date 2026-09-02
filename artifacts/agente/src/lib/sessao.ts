/**
 * The panel's session: one short-lived token, held in memory only.
 *
 * The token arrives in `location.hash` because a fragment is the one part of a
 * URL that browsers never send to a server and never write to an access log.
 * The Desk widget mints it and points the iframe here.
 *
 * Three rules follow from that, and each is load-bearing:
 *
 *  1. **Read it once, then erase it.** A token left in the address bar is one
 *     screenshot or one shoulder away from being someone else's. The hash is
 *     cleared with `replaceState` so it also leaves no history entry.
 *  2. **Memory, never storage.** `localStorage` and `sessionStorage` outlive
 *     the tab and are readable by anything else served from this origin. A
 *     15-minute token that survives the window it was minted for is no longer
 *     15 minutes.
 *  3. **Expiry is the widget's problem, not ours.** When the API says 401 we
 *     ask the parent frame to mint a new one; we never try to refresh
 *     ourselves, because only the widget can prove who the agent is.
 */

let token: string | null = null;

/** The message the widget listens for. Kept as a constant so both ends agree. */
export const PEDIDO_DE_TOKEN = "painel-agente:token-expirado";

/**
 * Take the token out of the URL fragment and keep it in memory.
 *
 * Call once, before the first request. Safe to call again: after the first call
 * the hash is empty, so a re-entry (React strict mode, a hot reload) does not
 * wipe a token that is already held.
 */
export function arrancarSessao(): void {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const t = params.get("token");
  if (!t) return;

  token = t;
  // Erase the fragment without adding a history entry, so Back does not walk
  // the agent into a URL that still carries their token.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function tokenAtual(): string | null {
  return token;
}

/**
 * Ask the parent frame for a fresh token and reload.
 *
 * Only reaches a parent that is actually a different frame — a panel opened
 * directly in a tab has no widget to ask, and posting to itself would spin.
 * `"*"` as the target origin carries nothing secret: the message is a request,
 * not a credential.
 */
export function pedirTokenNovo(): void {
  token = null;
  if (window.parent !== window) {
    window.parent.postMessage({ tipo: PEDIDO_DE_TOKEN }, "*");
  }
}

/** True when there is no widget above us — the panel was opened on its own. */
export function estaSolto(): boolean {
  return window.parent === window;
}
