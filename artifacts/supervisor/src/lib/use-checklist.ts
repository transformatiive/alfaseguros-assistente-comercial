import { useQuery } from "@tanstack/react-query";

/** Per-category aggregated stats, as returned by /api/stats/*. */
export interface CategoriaStat {
  categoryId: number;
  nome: string;
  obrigatoria: boolean;
  cumprido: number;
  naoCumprido: number;
  naoAplicavel: number;
  indeterminado: number;
  aplicavel: number;
  cobertura: number;
  taxa: number | null;
  exibePercentagem: boolean;
  absoluto: string;
  taxaPercent: number | null;
  pontoMaisFraco: { itemId: number; taxa: number; cumprido: number; aplicavel: number } | null;
  pontoMaisFracoNome: string | null;
  dispersaoColaboradores: number | null;
}

export interface EquipaStatsResponse {
  de: string;
  ate: string;
  minChamadas: number;
  categorias: CategoriaStat[];
}

export interface ColaboradorStats {
  colaboradorId: number;
  nome: string;
  categorias: CategoriaStat[];
}

export interface ColaboradorStatsResponse {
  de: string;
  ate: string;
  minChamadas: number;
  colaboradores: ColaboradorStats[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`Pedido falhou: HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function useEquipaStats(de: string, ate: string) {
  return useQuery({
    queryKey: ["checklist-equipa", de, ate],
    queryFn: () => getJson<EquipaStatsResponse>(`/api/stats/equipa?de=${de}&ate=${ate}`),
    enabled: Boolean(de && ate),
  });
}

export function useColaboradorStats(de: string, ate: string) {
  return useQuery({
    queryKey: ["checklist-colaborador", de, ate],
    queryFn: () => getJson<ColaboradorStatsResponse>(`/api/stats/colaborador?de=${de}&ate=${ate}`),
    enabled: Boolean(de && ate),
  });
}

/** Overall compliance across a set of categories (decided points only). */
export function overallRate(cats: CategoriaStat[]): { cumprido: number; aplicavel: number; pct: number | null } {
  let cumprido = 0;
  let aplicavel = 0;
  for (const c of cats) {
    cumprido += c.cumprido;
    aplicavel += c.aplicavel;
  }
  return { cumprido, aplicavel, pct: aplicavel > 0 ? Math.round((cumprido / aplicavel) * 100) : null };
}

/** Approx. number of evaluated calls = the max category coverage. */
export function maxCoverage(cats: CategoriaStat[]): number {
  return cats.reduce((m, c) => Math.max(m, c.cobertura), 0);
}
