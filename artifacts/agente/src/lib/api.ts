import { pedirTokenNovo, tokenAtual } from "./sessao";

/**
 * Thrown when the server rejects the token. Carried as its own type so callers
 * can tell "your session ended" apart from "the server broke" — the first is
 * routine and self-healing, the second needs a person.
 */
export class SessaoExpirada extends Error {
  constructor() {
    super("Sessão expirada");
    this.name = "SessaoExpirada";
  }
}

/**
 * GET a panel endpoint with the current token.
 *
 * A 401 asks the widget for a new token and then throws, rather than retrying:
 * the retry would race the widget's reload and could loop. The reload is the
 * recovery.
 */
export async function obter<T>(caminho: string): Promise<T> {
  const token = tokenAtual();
  if (!token) throw new SessaoExpirada();

  const res = await fetch(caminho, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    pedirTokenNovo();
    throw new SessaoExpirada();
  }
  if (!res.ok) {
    throw new Error(`O servidor respondeu ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function enviar<T>(caminho: string, corpo: unknown): Promise<T> {
  const token = tokenAtual();
  if (!token) throw new SessaoExpirada();

  const res = await fetch(caminho, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (res.status === 401) {
    pedirTokenNovo();
    throw new SessaoExpirada();
  }
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(texto || `O servidor respondeu ${res.status}`);
  }
  return (await res.json()) as T;
}
