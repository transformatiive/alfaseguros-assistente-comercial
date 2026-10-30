import { useQuery } from "@tanstack/react-query";

/** Mirrors GET /api/analise-chamadas/geral (artifacts/api-server/src/analise-chamadas/agregar.ts). */
export type EquipaAnalise = "360" | "vida" | "corporate" | "sem_agente";
export type FiltroEquipa = "todas" | "360" | "vida" | "corporate";

export interface Totais {
  recebidas: number;
  recebidasAtendidas: number;
  feitas: number;
  feitasAtendidas: number;
  atendidasPct: number | null;
  esperaMediaS: number | null;
  duracaoMediaS: number | null;
}

export interface VisaoGeralResponse {
  de: string;
  ate: string;
  equipa: FiltroEquipa;
  kpis: Totais & {
    clientes: number;
    clientesInsistentesPct: number | null;
    conversasReaisPct: number | null;
  };
  porDia: { dia: string; recebidas: number; feitas: number; recebidasAtendidas: number }[];
  porHora: { hora: number; recebidas: number; atendidas: number; pct: number | null }[];
  resultadosRecebidas: { id: "atendidas" | "caixa_voz" | "nao_atendidas"; nome: string; total: number; pct: number | null }[];
  porEquipa: ({ id: EquipaAnalise; nome: string } & Totais)[];
  porColaborador: ({ agenteId: string; nome: string; equipa: EquipaAnalise } & Totais)[];
  cobertura: {
    diasEmFalta: number;
    aSincronizar: boolean;
    primeiroDia: string | null;
    ultimoDia: string | null;
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `Pedido falhou: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep the generic message
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function useVisaoGeral(de: string, ate: string, equipa: FiltroEquipa) {
  return useQuery({
    queryKey: ["analise-chamadas-geral", de, ate, equipa],
    queryFn: () =>
      getJson<VisaoGeralResponse>(`/api/analise-chamadas/geral?de=${de}&ate=${ate}&equipa=${equipa}`),
    enabled: Boolean(de && ate && de <= ate),
    // While missing days are being pulled from Ringover, ask again until they land.
    refetchInterval: (q) => (q.state.data?.cobertura.aSincronizar ? 5000 : false),
    placeholderData: (prev) => prev,
  });
}
