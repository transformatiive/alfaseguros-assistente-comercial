import { useState } from "react";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Download, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useListaChamadas, type FiltroEquipa, type FonteLista, type LinhaLista } from "@/lib/use-analise-chamadas";
import { exportarExcel } from "@/lib/use-chamadas-sftp";
import { DetalheChamada } from "./campanha-vida";

/**
 * Análise de Chamadas · Chamadas (fase 6): uma lista com todas as chamadas
 * avaliadas pela IA, das três fontes. Cada linha abre o detalhe que já existe:
 * a conversa do Supervisor (com o caso do Desk) ou a ficha do guião (com a
 * gravação, a transcrição e a lead do noCRM).
 */

const NOMES_FONTE: Record<FonteLista, string> = {
  todas: "Todas as fontes",
  supervisor: "Supervisor (360)",
  ringover: "Ringover Vida",
  sftp: "Campanha SFTP",
};
const NOMES_EQUIPA: Record<string, string> = {
  todas: "Todas as equipas",
  "360": "Equipa 360",
  vida: "Equipa Vida",
  corporate: "Corporate",
  sem_agente: "Sem agente",
  campanha: "Campanha Vida",
};

const corNota = (p: number | null) =>
  p === null ? "text-stone-500" : p >= 85 ? "text-green-700" : p >= 70 ? "text-amber-700" : "text-red-700";

function dataTxt(l: LinhaLista): string {
  return l.data.length > 10
    ? format(parseISO(l.data), "d MMM HH:mm", { locale: pt })
    : format(parseISO(l.data), "d MMM", { locale: pt });
}

export default function ListaChamadas({ de, ate }: { de: string; ate: string }) {
  const [fonte, setFonte] = useState<FonteLista>("todas");
  const [equipa, setEquipa] = useState<FiltroEquipa>("todas");
  const [pessoa, setPessoa] = useState<string>("");
  const [aberta, setAberta] = useState<number | null>(null);
  const [, navegar] = useLocation();
  const q = useListaChamadas(de, ate, { fonte, equipa, pessoa: pessoa || null }, true);

  const abrir = (l: LinhaLista) => {
    if (l.fonte === "supervisor") navegar(`/conversas/${l.id}`);
    else setAberta(l.id);
  };

  const exportar = () => {
    if (!q.data) return;
    exportarExcel(`chamadas-${de}-a-${ate}`, ["Data", "Fonte", "Equipa", "Pessoa", "Tema", "Nota", "Resumo"],
      q.data.linhas.map((l) => [dataTxt(l), NOMES_FONTE[l.fonte], NOMES_EQUIPA[l.equipa] ?? l.equipa, l.pessoa, l.tema, l.notaTexto, l.resumo]));
  };

  const sel = "border border-stone-200 rounded-md px-2 py-1.5 bg-white text-sm max-w-full";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Fonte" value={fonte} onChange={(e) => setFonte(e.target.value as FonteLista)} className={sel}>
          {(Object.keys(NOMES_FONTE) as FonteLista[]).map((f) => <option key={f} value={f}>{NOMES_FONTE[f]}</option>)}
        </select>
        <select aria-label="Equipa" value={equipa} onChange={(e) => setEquipa(e.target.value as FiltroEquipa)} className={sel}>
          {(["todas", "360", "vida", "corporate"] as FiltroEquipa[]).map((e) => <option key={e} value={e}>{NOMES_EQUIPA[e]}</option>)}
        </select>
        <select aria-label="Pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)} className={sel}>
          <option value="">Todas as pessoas</option>
          {(q.data?.pessoas ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="mr-auto" />
        {q.data && q.data.total > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportar}>
            <Download className="mr-1 h-3 w-3" />Exportar Excel
          </Button>
        )}
      </div>

      {q.isPending && (
        <div className="flex items-center gap-2 text-stone-500 py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> A carregar as chamadas…</div>
      )}
      {q.isError && <p className="text-sm text-red-700">Não foi possível carregar as chamadas. Tente de novo dentro de momentos.</p>}
      {q.data && (
        <Card className={`border-stone-200 transition-opacity ${q.isFetching ? "opacity-70" : ""}`}>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-stone-100 text-xs text-stone-500">
              {q.data.total.toLocaleString("pt-PT")} chamadas avaliadas pela IA
              {q.data.truncado && " · a mostrar as 1000 mais recentes (use os filtros ou exporte)"}
            </div>
            {q.data.total === 0 ? (
              <p className="p-8 text-center text-sm text-stone-500">Nenhuma chamada com estes filtros.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {q.data.linhas.map((l) => (
                  <li key={l.chave}>
                    <button type="button" onClick={() => abrir(l)} className="w-full text-left px-4 py-2.5 hover:bg-stone-50">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className={`font-semibold tabular-nums ${corNota(l.notaPct)}`}>{l.notaTexto}</span>
                        <span className="font-medium text-stone-900">{l.pessoa}</span>
                        <span className="text-xs text-stone-500 tabular-nums">{dataTxt(l)}</span>
                        <Badge variant="outline" className="text-[10px] font-normal">{NOMES_FONTE[l.fonte]}</Badge>
                        <Badge variant="secondary" className="text-[10px] font-normal">{l.tema}</Badge>
                      </div>
                      <p className="text-[13px] text-stone-600 mt-0.5 line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{l.resumo || "Sem resumo."}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={aberta !== null} onOpenChange={(o) => { if (!o) setAberta(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {aberta !== null && <DetalheChamada id={aberta} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
