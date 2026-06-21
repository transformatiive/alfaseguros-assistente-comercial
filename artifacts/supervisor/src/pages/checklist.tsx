import { useState } from "react";
import { format, subDays } from "date-fns";
import { ClipboardCheck, AlertTriangle, Users, TrendingDown, Loader2, Shield, ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useEquipaStats,
  useColaboradorStats,
  overallRate,
  maxCoverage,
  type CategoriaStat,
  type ColaboradorStats,
} from "@/lib/use-checklist";

/** A concrete coaching action for one operator: the weakest measured criterion. */
interface CoachingItem {
  categoria: string;
  criterio: string;
  mensagem: string | null;
  taxaPct: number;
  aplicavel: number;
}

/**
 * Turn an operator's category stats into a prioritized, actionable coaching
 * list: the weakest measured criteria (lowest compliance first). This is what
 * makes the per-operator view tell a coordinator *what to do*, not just a %.
 */
function coachingItems(cats: CategoriaStat[]): CoachingItem[] {
  return cats
    .filter((c) => c.pontoMaisFraco !== null && c.pontoMaisFraco.taxa < 1 && c.pontoMaisFracoCriterio !== null)
    .map((c) => ({
      categoria: c.nome,
      criterio: c.pontoMaisFracoCriterio as string,
      mensagem: c.pontoMaisFracoMensagem,
      taxaPct: Math.round((c.pontoMaisFraco as { taxa: number }).taxa * 100),
      aplicavel: (c.pontoMaisFraco as { aplicavel: number }).aplicavel,
    }))
    .sort((a, b) => a.taxaPct - b.taxaPct);
}

function rateColor(pct: number | null): string {
  if (pct === null) return "text-stone-400";
  if (pct >= 70) return "text-green-600";
  if (pct >= 40) return "text-amber-600";
  return "text-red-600";
}
function barColor(pct: number | null): string {
  if (pct === null) return "bg-stone-300";
  if (pct >= 70) return "bg-green-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function RateBar({ pct }: { pct: number | null }) {
  return (
    <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
      <div className={`h-full ${barColor(pct)}`} style={{ width: `${pct ?? 0}%` }} />
    </div>
  );
}

function CategoryCard({ c }: { c: CategoriaStat }) {
  return (
    <Card className="border-stone-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-stone-900 leading-snug">{c.nome}</h3>
            <div className="mt-1 flex items-center gap-2">
              {c.obrigatoria && (
                <Badge variant="outline" className="text-[10px] border-red-200 text-red-700">
                  <Shield className="h-3 w-3 mr-1" /> Obrigatória
                </Badge>
              )}
              <span className="text-xs text-stone-500">
                Cobertura: {c.cobertura} {c.cobertura === 1 ? "chamada" : "chamadas"}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            {c.exibePercentagem ? (
              <div className={`text-3xl font-serif ${rateColor(c.taxaPercent)}`} style={{ fontFamily: "Georgia, serif" }}>
                {c.taxaPercent}%
              </div>
            ) : (
              <div className="text-right">
                <div className="text-lg font-serif text-stone-700" style={{ fontFamily: "Georgia, serif" }}>
                  {c.absoluto}
                </div>
                <div className="text-[10px] text-amber-600">amostra pequena</div>
              </div>
            )}
          </div>
        </div>

        {c.exibePercentagem && (
          <div className="mt-3">
            <RateBar pct={c.taxaPercent} />
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          <div><div className="font-medium text-green-600">{c.cumprido}</div><div className="text-stone-400">cumprido</div></div>
          <div><div className="font-medium text-red-600">{c.naoCumprido}</div><div className="text-stone-400">não cumpr.</div></div>
          <div><div className="font-medium text-stone-500">{c.naoAplicavel}</div><div className="text-stone-400">n/aplic.</div></div>
          <div><div className="font-medium text-stone-400">{c.indeterminado}</div><div className="text-stone-400">a rever</div></div>
        </div>

        {c.pontoMaisFracoNome && (
          <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 border-l-2 border-amber-400">
            <div className="flex items-start gap-2">
              <TrendingDown className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-stone-700 leading-relaxed">
                <div className="text-[10px] uppercase tracking-wide text-stone-500">
                  Ponto mais fraco · {c.pontoMaisFracoNome}
                </div>
                <div className="font-medium text-stone-900 mt-0.5">
                  {c.pontoMaisFracoCriterio ?? c.pontoMaisFracoNome}
                </div>
                {c.pontoMaisFraco && (
                  <div className="text-stone-600 mt-1">
                    Cumprido em apenas <strong>{Math.round(c.pontoMaisFraco.taxa * 100)}%</strong> das {c.pontoMaisFraco.aplicavel}{" "}
                    {c.pontoMaisFraco.aplicavel === 1 ? "chamada aplicável" : "chamadas aplicáveis"} — maior prioridade de coaching.
                  </div>
                )}
                {c.pontoMaisFracoMensagem && (
                  <div className="mt-1 text-stone-700">
                    <span className="font-medium text-amber-700">Como melhorar: </span>
                    {c.pontoMaisFracoMensagem}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {c.dispersaoColaboradores !== null && c.dispersaoColaboradores > 0.15 && (
          <div className="mt-2 text-xs text-stone-500">
            <Users className="h-3 w-3 inline mr-1" />
            Dispersão entre colaboradores: ±{Math.round(c.dispersaoColaboradores * 100)}pp
            <span className="text-stone-400"> (variação significativa)</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ColaboradorCard({ op }: { op: ColaboradorStats }) {
  const [open, setOpen] = useState(false);
  const o = overallRate(op.categorias);
  const cov = maxCoverage(op.categorias);
  const acoes = coachingItems(op.categorias);

  return (
    <Card className="border-stone-200">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 text-left"
          disabled={cov === 0}
        >
          <div className="flex items-center gap-2 min-w-0">
            {cov > 0 &&
              (open ? (
                <ChevronDown className="h-4 w-4 text-stone-400 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-stone-400 shrink-0" />
              ))}
            <div className="min-w-0">
              <div className="font-medium text-stone-900 truncate">{op.nome}</div>
              <div className="text-xs text-stone-500">
                {cov} {cov === 1 ? "chamada avaliada" : "chamadas avaliadas"}
                {cov > 0 && acoes.length > 0 && (
                  <span className="text-amber-600">
                    {" · "}
                    {acoes.length} {acoes.length === 1 ? "ponto a reforçar" : "pontos a reforçar"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`text-2xl font-serif shrink-0 ${rateColor(o.pct)}`} style={{ fontFamily: "Georgia, serif" }}>
            {cov === 0 ? "—" : o.pct !== null ? `${o.pct}%` : "—"}
          </div>
        </button>

        {cov > 0 && <div className="mt-3"><RateBar pct={o.pct} /></div>}

        {open && cov > 0 && (
          <div className="mt-4 space-y-2">
            {acoes.length === 0 ? (
              <div className="text-xs text-green-700 bg-green-50 rounded-md px-3 py-2">
                Sem pontos críticos a reforçar neste período. Bom trabalho.
              </div>
            ) : (
              acoes.map((a, i) => (
                <div key={i} className="rounded-md border border-stone-200 bg-stone-50/60 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-stone-400">{a.categoria}</div>
                      <div className="text-sm font-medium text-stone-900 leading-snug mt-0.5">{a.criterio}</div>
                    </div>
                    <div className={`text-sm font-serif shrink-0 ${rateColor(a.taxaPct)}`} style={{ fontFamily: "Georgia, serif" }}>
                      {a.taxaPct}%
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-500 mt-1">
                    Cumprido em {a.taxaPct}% de {a.aplicavel} {a.aplicavel === 1 ? "chamada aplicável" : "chamadas aplicáveis"}.
                  </div>
                  {a.mensagem && (
                    <div className="text-xs text-stone-700 mt-1.5 flex items-start gap-1.5">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span><span className="font-medium text-amber-700">Como melhorar: </span>{a.mensagem}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className={`text-2xl font-serif ${alert ? "text-red-600" : "text-stone-900"}`} style={{ fontFamily: "Georgia, serif" }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-stone-400 mt-1">{label}</div>
    </div>
  );
}

export default function Checklist() {
  const [de, setDe] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [ate, setAte] = useState(format(new Date(), "yyyy-MM-dd"));

  const equipa = useEquipaStats(de, ate);
  const colaborador = useColaboradorStats(de, ate);

  const cats = equipa.data?.categorias ?? [];
  const ov = overallRate(cats);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-cyan-700" />
            Checklist — Equipa Vida
          </h1>
          <p className="text-sm text-stone-500 italic">Cumprimento do guião do 1.º telefonema, por categoria.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-stone-500">
            De<br />
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-stone-500">
            Até<br />
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="mt-1 rounded border border-stone-300 px-2 py-1 text-sm" />
          </label>
        </div>
      </div>

      <Tabs defaultValue="equipa">
        <TabsList>
          <TabsTrigger value="equipa">Equipa</TabsTrigger>
          <TabsTrigger value="colaborador">Por Colaborador</TabsTrigger>
        </TabsList>

        {/* ---- Equipa ---- */}
        <TabsContent value="equipa" className="mt-4">
          {equipa.isLoading ? (
            <div className="flex items-center gap-2 text-stone-500 py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
            </div>
          ) : equipa.isError ? (
            <div className="flex items-center gap-2 text-red-600 py-10 justify-center">
              <AlertTriangle className="h-4 w-4" /> Não foi possível carregar as estatísticas.
            </div>
          ) : cats.length === 0 ? (
            <div className="text-center text-stone-500 py-10">
              Sem análises de checklist neste período. Ajuste as datas.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <Kpi label="Chamadas avaliadas" value={String(maxCoverage(cats))} />
                <Kpi label="Taxa de cumprimento" value={ov.pct !== null ? `${ov.pct}%` : "—"} alert={ov.pct !== null && ov.pct < 40} />
                <Kpi label="Pontos cumpridos" value={String(ov.cumprido)} />
                <Kpi label="Pontos não cumpridos" value={String(ov.aplicavel - ov.cumprido)} alert />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cats.map((c) => <CategoryCard key={c.categoryId} c={c} />)}
              </div>
            </>
          )}
        </TabsContent>

        {/* ---- Por Colaborador ---- */}
        <TabsContent value="colaborador" className="mt-4">
          {colaborador.isLoading ? (
            <div className="flex items-center gap-2 text-stone-500 py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
            </div>
          ) : colaborador.isError ? (
            <div className="flex items-center gap-2 text-red-600 py-10 justify-center">
              <AlertTriangle className="h-4 w-4" /> Não foi possível carregar.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-stone-500 italic">
                Clique num colaborador para ver os critérios a reforçar e como melhorar.
              </p>
              {(colaborador.data?.colaboradores ?? []).map((op) => (
                <ColaboradorCard key={op.colaboradorId} op={op} />
              ))}
              {(colaborador.data?.colaboradores ?? []).every((op) => maxCoverage(op.categorias) === 0) && (
                <div className="text-center text-stone-500 py-6">Sem dados de colaboradores neste período.</div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
