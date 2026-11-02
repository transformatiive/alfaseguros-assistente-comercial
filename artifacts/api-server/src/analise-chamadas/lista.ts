import { conversationAnalysisSchema } from "../analysis/schema.js";
import { percentagem } from "../chamadas-sftp/agregar.js";
import { tipoGuiao, type TipoChamada } from "../chamadas-sftp/catalogo.js";
import type { ConversaPara360 } from "./agregar-360.js";
import { resolverEquipa, type EquipaAnalise, type EquipaColaborador, type FiltroEquipa } from "./agregar.js";

/**
 * Análise de Chamadas · Chamadas (fase 6): uma lista única com todas as
 * chamadas que alguma IA avaliou, venham de onde vierem:
 * - "supervisor": as conversas da análise diária (Ringover, 360 e restantes),
 *   que abrem no detalhe da conversa já existente;
 * - "ringover": as chamadas da equipa Vida avaliadas com o guião;
 * - "sftp": as gravações da campanha SolidNetworks.
 * As duas últimas abrem no mesmo detalhe (gravação, pontos do guião, transcrição).
 *
 * Pura: recebe linhas já lidas, devolve a lista filtrada, mais recente primeiro.
 */

export const FONTES_LISTA = ["todas", "supervisor", "ringover", "sftp"] as const;
export type FiltroFonteLista = (typeof FONTES_LISTA)[number];

export interface LinhaLista {
  /** "c-<id>" para conversas, "g-<id>" para chamadas avaliadas com o guião. */
  chave: string;
  fonte: Exclude<FiltroFonteLista, "todas">;
  id: number;
  data: string; // ISO (guião) ou AAAA-MM-DD (conversas, só o dia)
  equipa: EquipaAnalise | "campanha";
  pessoa: string;
  tema: string;
  /** Nota em %: guião cumprido, ou qualidade da IA (1 a 5) passada a %. */
  notaPct: number | null;
  /** Texto curto da nota, como aparece no detalhe ("4/5" ou "78%"). */
  notaTexto: string;
  resumo: string;
  estado: string;
}

export interface ChamadaGuiaoLista {
  id: number;
  fonte: "sftp" | "ringover";
  dataHora: Date;
  estado: string;
  colaborador: string;
  agenteId: string | null;
  tipo: string | null;
  resumo: string | null;
  motivoDescarte: string | null;
}

export interface FiltrosLista {
  fonte: FiltroFonteLista;
  equipa: FiltroEquipa;
  pessoa: string | null;
}

export function montarLista(input: {
  conversas: readonly ConversaPara360[];
  guiao: readonly ChamadaGuiaoLista[];
  /** Por chamada avaliada com o guião: contas para a %. */
  contas: ReadonlyMap<number, { cumpriu: number; nao: number }>;
  roster: ReadonlyMap<string, EquipaColaborador>;
  filtros: FiltrosLista;
}): { linhas: LinhaLista[]; pessoas: string[] } {
  const todas: LinhaLista[] = [];

  for (const c of input.conversas) {
    const p = conversationAnalysisSchema.safeParse(c.analise);
    if (!p.success) continue;
    const a = p.data;
    todas.push({
      chave: `c-${c.id}`,
      fonte: "supervisor",
      id: c.id,
      data: c.dia,
      equipa: resolverEquipa(c.agenteId, c.agenteNome, input.roster),
      pessoa: c.agenteNome?.trim() || "Sem pessoa",
      tema: a.categoria?.trim() || "Outro",
      notaPct: Math.round((a.qualidadeGlobal / 5) * 100),
      notaTexto: `${a.qualidadeGlobal}/5`,
      resumo: a.narrativaConversa,
      estado: "analisada",
    });
  }

  for (const g of input.guiao) {
    const ct = input.contas.get(g.id);
    const pct = ct ? percentagem(ct) : null;
    todas.push({
      chave: `g-${g.id}`,
      fonte: g.fonte,
      id: g.id,
      data: g.dataHora.toISOString(),
      equipa: g.fonte === "sftp" ? "campanha" : "vida",
      pessoa: g.colaborador,
      tema: g.tipo ? tipoGuiao(g.tipo as TipoChamada).nome : "Sem tipo",
      notaPct: pct,
      notaTexto: pct === null ? "—" : `${Math.round(pct)}%`,
      resumo: g.resumo || g.motivoDescarte || "",
      estado: g.estado,
    });
  }

  const f = input.filtros;
  const porFonteEquipa = todas.filter(
    (l) =>
      (f.fonte === "todas" || l.fonte === f.fonte) &&
      (f.equipa === "todas" || l.equipa === f.equipa),
  );
  const pessoas = [...new Set(porFonteEquipa.map((l) => l.pessoa))].sort((a, b) => a.localeCompare(b, "pt"));
  const linhas = porFonteEquipa
    .filter((l) => !f.pessoa || l.pessoa === f.pessoa)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return { linhas, pessoas };
}
