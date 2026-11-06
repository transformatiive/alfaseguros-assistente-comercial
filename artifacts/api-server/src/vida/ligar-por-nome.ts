/**
 * Liga colaboradores da equipa Vida a utilizadores do noCRM pelo nome, quando
 * o email não coincide. Compara o primeiro e o último nome, sem acentos nem
 * maiúsculas ("Cláudia Gaião" = "claudia gaiao"). Só liga quando há um único
 * utilizador com esse par e esse utilizador ainda não está ligado a ninguém,
 * para nunca juntar duas pessoas por engano.
 */

export interface ColabSemLigacao {
  id: number;
  nome: string;
}

export interface UserNocrm {
  id: number;
  nome: string;
}

/** "Cláudia  Gaião " → "claudia gaiao": primeiro e último nome, sem acentos. */
export function chaveDoNome(nome: string): string | null {
  const partes = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length < 2) return null;
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

/** Devolve os pares colaborador → utilizador noCRM a gravar. */
export function ligarPorNome(
  colabs: ColabSemLigacao[],
  users: UserNocrm[],
  jaLigados: Set<number>,
): { colaboradorId: number; nocrmUserId: number }[] {
  const porChave = new Map<string, number[]>();
  for (const u of users) {
    const k = chaveDoNome(u.nome);
    if (!k) continue;
    porChave.set(k, [...(porChave.get(k) ?? []), u.id]);
  }
  const usados = new Set(jaLigados);
  const pares: { colaboradorId: number; nocrmUserId: number }[] = [];
  for (const c of colabs) {
    const k = chaveDoNome(c.nome);
    const ids = k ? porChave.get(k) : undefined;
    if (!ids || ids.length !== 1) continue;
    const id = ids[0];
    if (usados.has(id)) continue;
    usados.add(id);
    pares.push({ colaboradorId: c.id, nocrmUserId: id });
  }
  return pares;
}
