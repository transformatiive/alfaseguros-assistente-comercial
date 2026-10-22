import React, { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import {
  ArrowDownRight, ArrowUpRight, Download, FileText, Info, Loader2, Minus, Sparkles,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  exportarExcel, NOMES_DESFECHO, NOMES_OBJECAO, NOMES_TIPO, TIPOS, urlAudio,
  useChamada, useChamadas, useResumo, useTranscricao,
  type ChamadaLinha, type PontoAgregado, type ResumoResponse, type TipoChamada,
} from "@/lib/use-analise-chamadas";

/**
 * Análise de Chamadas Vida (TRNSF-2206): gravações do SFTP, transcritas de
 * noite e avaliadas contra o guião. Mesmo aspeto do Resumo Diário.
 */

type Vista = "geral" | TipoChamada | "chamadas";
type Periodo = "7" | "30" | "campanha";
type Res = "cumpriu" | "nao" | "rever";

/** Início da campanha Vida (primeiras gravações no SFTP). */
const INICIO_CAMPANHA = "2026-10-01";

const COR = {
  amber: "hsl(var(--chart-1))",
  navy: "hsl(var(--chart-2))",
  green: "hsl(var(--chart-3))",
  red: "hsl(var(--chart-4))",
  muted: "hsl(var(--muted-foreground))",
};
const CORES_TIPO: Record<TipoChamada, string> = {
  primeiro: COR.navy,
  seguinte: COR.amber,
  proposta: COR.green,
  pos_venda: "hsl(var(--chart-5))",
};

const hojeLisboa = () => format(new Date(), "yyyy-MM-dd");

function datasDoPeriodo(p: Periodo): { de: string; ate: string } {
  const ate = hojeLisboa();
  if (p === "campanha") return { de: INICIO_CAMPANHA, ate };
  return { de: format(subDays(new Date(), Number(p) - 1), "yyyy-MM-dd"), ate };
}

const pctTxt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

function corPct(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 80) return "text-emerald-700";
  if (v >= 60) return "text-amber-700";
  return "text-red-700";
}

function duracao(s: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function dataHora(iso: string): string {
  return format(new Date(iso), "dd/MM HH:mm", { locale: pt });
}

// ---------------------------------------------------------------------------

function Variacao({ atual, anterior, sufixo = " pp" }: { atual: number | null; anterior: number | null; sufixo?: string }) {
  if (atual === null || anterior === null) return <span className="text-[11px] text-muted-foreground">sem comparação</span>;
  const d = Math.round(atual - anterior);
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] tabular-nums", d > 0 ? "text-emerald-700" : d < 0 ? "text-red-700" : "text-muted-foreground")}>
      <Icon className="h-3 w-3" />
      {d > 0 ? "+" : ""}{d}{sufixo} vs período anterior
    </span>
  );
}

function Kpi({ label, ajuda, valor, extra }: { label: string; ajuda: string; valor: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger asChild><Info className="h-3 w-3 cursor-help" /></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{ajuda}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-1 text-3xl tabular-nums leading-none" style={{ fontFamily: "Georgia, serif" }}>{valor}</div>
      {extra && <div className="mt-1.5">{extra}</div>}
    </div>
  );
}

function Seccao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h2>
        {acao}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface Filtro { titulo: string; tipo?: TipoChamada | null; item?: string | null; res?: Res | null }

export default function AnaliseChamadas() {
  const [vista, setVista] = useState<Vista>("geral");
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [chamadaId, setChamadaId] = useState<number | null>(null);
  const { de, ate } = useMemo(() => datasDoPeriodo(periodo), [periodo]);
  const resumo = useResumo(de, ate);
  const r = resumo.data;

  const abrir = (f: Filtro) => { setChamadaId(null); setFiltro(f); };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análise de Chamadas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Campanha Vida · gravações do SFTP avaliadas contra o guião
            {r?.ultimaAnalise && <> · última análise {dataHora(r.ultimaAnalise)}</>}
          </p>
        </div>
        <div className="flex gap-1.5">
          {([["7", "7 dias"], ["30", "30 dias"], ["campanha", "Campanha"]] as const).map(([v, l]) => (
            <Button key={v} variant="outline" size="sm" className={cn("text-xs", periodo === v && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")} onClick={() => setPeriodo(v)}>
              {l}
            </Button>
          ))}
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b">
        {(["geral", ...TIPOS, "chamadas"] as Vista[]).map((v) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            className={cn("px-3 py-2 text-xs -mb-px border-b-2 transition-colors", vista === v ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {v === "geral" ? "Visão geral" : v === "chamadas" ? "Chamadas" : NOMES_TIPO[v]}
          </button>
        ))}
      </nav>

      {resumo.isLoading && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {resumo.isError && <p className="text-sm text-red-700">Não foi possível carregar a análise. Tente de novo dentro de momentos.</p>}

      {r && !r.configurado && r.kpis.recebidas === 0 && (
        <div className="rounded-md border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          A ligação ao arquivo de gravações ainda não está configurada. Assim que estiver, as chamadas aparecem aqui no dia seguinte.
        </div>
      )}
      {r && (r.configurado || r.kpis.recebidas > 0) && (
        <>
          {vista === "geral" && <VisaoGeral r={r} abrir={abrir} />}
          {TIPOS.includes(vista as TipoChamada) && <VistaTipo r={r} tipo={vista as TipoChamada} abrir={abrir} />}
          {vista === "chamadas" && <ListaChamadas de={de} ate={ate} onAbrir={setChamadaId} />}
        </>
      )}

      <Sheet open={filtro !== null || chamadaId !== null} onOpenChange={(o) => { if (!o) { setFiltro(null); setChamadaId(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {chamadaId !== null ? (
            <DetalheChamada id={chamadaId} voltar={filtro ? () => setChamadaId(null) : undefined} />
          ) : filtro ? (
            <ChamadasDoFiltro de={de} ate={ate} filtro={filtro} onAbrir={setChamadaId} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Kpis({ r }: { r: ResumoResponse }) {
  const k = r.kpis;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="Chamadas recebidas" ajuda="Todas as gravações que chegaram ao SFTP no período." valor={k.recebidas}
        extra={<span className="text-[11px] text-muted-foreground">{k.curtas} curtas · {k.pendentes} por transcrever{k.erros ? ` · ${k.erros} com erro` : ""}</span>} />
      <Kpi label="Analisadas" ajuda="Chamadas com conversa útil, avaliadas contra o guião. As sem conversa (caixa de correio, não atendeu) ficam fora." valor={k.analisadas}
        extra={<span className="text-[11px] text-muted-foreground">{k.descartadas} sem conversa útil</span>} />
      <Kpi label="Cumprimento do guião" ajuda="Pontos cumpridos sobre pontos avaliados. Os que não se aplicam e os que estão a rever ficam fora do total." valor={<span className={corPct(k.cumprimentoPct)}>{pctTxt(k.cumprimentoPct)}</span>}
        extra={<Variacao atual={k.cumprimentoPct} anterior={r.anterior.cumprimentoPct} />} />
      <Kpi label="A rever" ajuda="Pontos onde a IA teve pouca confiança (menos de 70%). Vale a pena ouvir a gravação." valor={k.aRever}
        extra={<span className="text-[11px] text-muted-foreground">pontos com pouca confiança</span>} />
    </div>
  );
}

function Destaques({ r, abrir }: { r: ResumoResponse; abrir: (f: Filtro) => void }) {
  const d = r.destaques;
  if (!d || d.destaques.length === 0) return null;
  return (
    <section className="rounded-md border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
        <Sparkles className="h-3.5 w-3.5" /> Destaques da IA
        <span className="font-normal normal-case tracking-normal text-amber-700/80">· {d.periodoDe.slice(8)}/{d.periodoDe.slice(5, 7)} a {d.periodoAte.slice(8)}/{d.periodoAte.slice(5, 7)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {d.destaques.map((x, i) => {
          const clicavel = Boolean(x.item);
          return (
            <button
              key={i}
              disabled={!clicavel}
              onClick={() => x.item && abrir({ titulo: x.titulo, item: x.item, res: "nao" })}
              className={cn("rounded-md border bg-card p-3 text-left", clicavel && "hover:border-amber-400 transition-colors")}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">{x.etiqueta}</div>
              <div className="mt-1 text-sm font-semibold">{x.titulo}</div>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground" style={{ fontFamily: "Georgia, serif" }}>{x.texto}</p>
              {clicavel && <div className="mt-2 text-[11px] text-amber-700">Ver chamadas →</div>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function VisaoGeral({ r, abrir }: { r: ResumoResponse; abrir: (f: Filtro) => void }) {
  const tipos = r.porTipo.filter((t) => t.chamadas > 0);
  const totalTipos = tipos.reduce((s, t) => s + t.chamadas, 0);
  const comBase = r.pontos.filter((p) => p.cumpriu + p.nao >= 3 && p.pct !== null);
  const fracos = [...comBase].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 5);
  const fortes = [...comBase].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 5);

  const exportar = () =>
    exportarExcel(`analise-chamadas-${r.de}-a-${r.ate}`,
      ["Tipo", "Secção", "Ponto", "Cumpriu", "Não cumpriu", "A rever", "Não se aplica", "% cumprimento", "% período anterior"],
      r.pontos.map((p) => [NOMES_TIPO[p.tipo], p.seccao, p.validacao, p.cumpriu, p.nao, p.rever, p.naoAplicavel, p.pct, r.anterior.pontos[p.item] ?? null]));

  return (
    <div className="space-y-5">
      <Kpis r={r} />
      <Destaques r={r} abrir={abrir} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Seccao titulo="Cumprimento por tipo">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={r.porTipo} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip formatter={(v: number) => `${Math.round(v)}%`} />
              <Bar dataKey="pct" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11, formatter: (v: number | null) => pctTxt(v) }} isAnimationActive animationDuration={800}>
                {r.porTipo.map((t) => <Cell key={t.tipo} fill={CORES_TIPO[t.tipo]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Seccao>

        <Seccao titulo="Chamadas por tipo">
          {totalTipos === 0 ? <Vazio /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={tipos} dataKey="chamadas" nameKey="nome" innerRadius={45} outerRadius={70} paddingAngle={2}
                  label={({ nome, chamadas }: { nome: string; chamadas: number }) => `${nome.replace("Telefonemas ", "")} ${Math.round((chamadas / totalTipos) * 100)}%`}
                  labelLine={false} fontSize={10} isAnimationActive animationDuration={800}>
                  {tipos.map((t) => <Cell key={t.tipo} fill={CORES_TIPO[t.tipo]} />)}
                </Pie>
                <RTooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Seccao>

        <Seccao titulo="Evolução diária">
          {r.porDia.length === 0 ? <Vazio /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={r.porDia} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="data" tickFormatter={(d: string) => `${d.slice(8)}/${d.slice(5, 7)}`} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <RTooltip labelFormatter={(d: string) => `${d.slice(8)}/${d.slice(5, 7)}`} formatter={(v: number, n: string) => (n === "pct" ? [`${Math.round(v)}%`, "Cumprimento"] : [v, "Chamadas"])} />
                <Line type="monotone" dataKey="pct" stroke={COR.navy} strokeWidth={2} dot={{ r: 3 }} isAnimationActive animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Seccao>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Seccao titulo="Pontos mais fracos"><ListaPontos pontos={fracos} anterior={r.anterior.pontos} abrir={abrir} res="nao" /></Seccao>
        <Seccao titulo="Pontos mais fortes"><ListaPontos pontos={fortes} anterior={r.anterior.pontos} abrir={abrir} res="cumpriu" /></Seccao>
      </div>

      <Seccao titulo="Resumo por tipo" acao={<Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportar}><Download className="mr-1 h-3 w-3" />Exportar Excel</Button>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 font-semibold">Tipo</th>
              <th className="pb-2 font-semibold text-right">Chamadas</th>
              <th className="pb-2 font-semibold text-right">Cumpriu</th>
              <th className="pb-2 font-semibold text-right">Não cumpriu</th>
              <th className="pb-2 font-semibold text-right">A rever</th>
              <th className="pb-2 font-semibold text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {r.porTipo.map((t) => {
              const ps = r.pontos.filter((p) => p.tipo === t.tipo);
              const soma = (k: "cumpriu" | "nao" | "rever") => ps.reduce((s, p) => s + p[k], 0);
              return (
                <tr key={t.tipo} className="border-t">
                  <td className="py-2">{t.nome}</td>
                  <td className="py-2 text-right tabular-nums">
                    <Contagem n={t.chamadas} onClick={() => abrir({ titulo: t.nome, tipo: t.tipo })} />
                  </td>
                  <td className="py-2 text-right tabular-nums text-emerald-700">{soma("cumpriu")}</td>
                  <td className="py-2 text-right tabular-nums text-red-700">{soma("nao")}</td>
                  <td className="py-2 text-right tabular-nums text-amber-700">{soma("rever")}</td>
                  <td className={cn("py-2 text-right tabular-nums font-semibold", corPct(t.pct))}>{pctTxt(t.pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Seccao>
    </div>
  );
}

function Vazio() {
  return <p className="py-10 text-center text-xs text-muted-foreground">Sem chamadas analisadas neste período.</p>;
}

function Contagem({ n, onClick, className }: { n: number; onClick: () => void; className?: string }) {
  if (n === 0) return <span className={cn("text-muted-foreground", className)}>0</span>;
  return <button onClick={onClick} className={cn("underline decoration-dotted underline-offset-2 hover:decoration-solid", className)}>{n}</button>;
}

function ListaPontos({ pontos, anterior, abrir, res }: { pontos: PontoAgregado[]; anterior: Record<string, number | null>; abrir: (f: Filtro) => void; res: Res }) {
  if (pontos.length === 0) return <p className="text-xs text-muted-foreground">Ainda não há base suficiente (mínimo 3 avaliações por ponto).</p>;
  return (
    <ul className="space-y-2.5">
      {pontos.map((p) => (
        <li key={p.item}>
          <button className="w-full text-left" onClick={() => abrir({ titulo: p.validacao, item: p.item, res })}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">{p.validacao}<span className="ml-1.5 text-[11px] text-muted-foreground">{NOMES_TIPO[p.tipo]}</span></span>
              <span className={cn("tabular-nums text-sm font-semibold", corPct(p.pct))}>{pctTxt(p.pct)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-muted">
              <div className="h-1.5 rounded transition-all duration-700" style={{ width: `${p.pct ?? 0}%`, background: (p.pct ?? 0) >= 80 ? COR.green : (p.pct ?? 0) >= 60 ? COR.amber : COR.red }} />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {p.cumpriu} de {p.cumpriu + p.nao}{anterior[p.item] != null && <> · antes {pctTxt(anterior[p.item])}</>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function VistaTipo({ r, tipo, abrir }: { r: ResumoResponse; tipo: TipoChamada; abrir: (f: Filtro) => void }) {
  const t = r.porTipo.find((x) => x.tipo === tipo);
  const pontos = r.pontos.filter((p) => p.tipo === tipo);
  const seccoes = [...new Set(pontos.map((p) => p.seccao))];
  const resumoIa = r.destaques?.resumoPorTipo?.[tipo];

  const exportar = () =>
    exportarExcel(`analise-chamadas-${tipo}-${r.de}-a-${r.ate}`,
      ["Secção", "Ponto", "Pergunta", "Cumpriu", "Não cumpriu", "A rever", "Não se aplica", "% cumprimento", "% período anterior"],
      pontos.map((p) => [p.seccao, p.validacao, p.pergunta, p.cumpriu, p.nao, p.rever, p.naoAplicavel, p.pct, r.anterior.pontos[p.item] ?? null]));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Chamadas" ajuda="Chamadas analisadas deste tipo no período." valor={<Contagem n={t?.chamadas ?? 0} onClick={() => abrir({ titulo: NOMES_TIPO[tipo], tipo })} />} />
        <Kpi label="Cumprimento" ajuda="Pontos cumpridos sobre pontos avaliados, só deste tipo." valor={<span className={corPct(t?.pct ?? null)}>{pctTxt(t?.pct)}</span>} />
        <Kpi label="A rever" ajuda="Pontos deste tipo com pouca confiança da IA." valor={pontos.reduce((s, p) => s + p.rever, 0)} />
      </div>

      {resumoIa && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800"><Sparkles className="h-3 w-3" />Resumo da IA</div>
          <p className="mt-1 text-sm leading-snug" style={{ fontFamily: "Georgia, serif" }}>{resumoIa}</p>
        </div>
      )}

      <Seccao titulo={`Guião · ${NOMES_TIPO[tipo]}`} acao={<Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportar}><Download className="mr-1 h-3 w-3" />Exportar Excel</Button>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 font-semibold">Ponto</th>
              <th className="pb-2 font-semibold text-right">Cumpriu</th>
              <th className="pb-2 font-semibold text-right">Não cumpriu</th>
              <th className="pb-2 font-semibold text-right">A rever</th>
              <th className="pb-2 font-semibold text-right">N/A</th>
              <th className="pb-2 font-semibold text-right">%</th>
              <th className="pb-2 font-semibold text-right">Antes</th>
            </tr>
          </thead>
          {seccoes.map((s) => (
            <tbody key={s}>
              <tr><td colSpan={7} className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s}</td></tr>
              {pontos.filter((p) => p.seccao === s).map((p) => (
                <tr key={p.item} className="border-t">
                  <td className="py-2 pr-3">
                    <Tooltip>
                      <TooltipTrigger asChild><span className="cursor-help">{p.validacao}</span></TooltipTrigger>
                      <TooltipContent className="max-w-sm text-xs">{p.pergunta}</TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="py-2 text-right tabular-nums"><Contagem n={p.cumpriu} className="text-emerald-700" onClick={() => abrir({ titulo: `${p.validacao} · cumpriu`, item: p.item, res: "cumpriu" })} /></td>
                  <td className="py-2 text-right tabular-nums"><Contagem n={p.nao} className="text-red-700" onClick={() => abrir({ titulo: `${p.validacao} · não cumpriu`, item: p.item, res: "nao" })} /></td>
                  <td className="py-2 text-right tabular-nums"><Contagem n={p.rever} className="text-amber-700" onClick={() => abrir({ titulo: `${p.validacao} · a rever`, item: p.item, res: "rever" })} /></td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{p.naoAplicavel}</td>
                  <td className={cn("py-2 text-right tabular-nums font-semibold", corPct(p.pct))}>{pctTxt(p.pct)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{pctTxt(r.anterior.pontos[p.item])}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </Seccao>
    </div>
  );
}

// ---------------------------------------------------------------------------

const NOMES_ESTADO: Record<string, string> = {
  analisada: "Analisada",
  descartada: "Sem conversa útil",
  curta: "Curta",
  pendente: "Por transcrever",
  erro: "Erro",
};

function exportarChamadas(nome: string, chamadas: ChamadaLinha[]) {
  exportarExcel(nome,
    ["Data", "Duração", "Estado", "Colaborador", "Tipo", "Desfecho", "Objeções", "% cumprimento", "Pontos a rever", "Resumo", "Ficheiro"],
    chamadas.map((c) => [dataHora(c.dataHora), duracao(c.duracaoS), NOMES_ESTADO[c.estado] ?? c.estado, c.colaborador,
      c.tipo ? NOMES_TIPO[c.tipo] : "", c.desfecho ? NOMES_DESFECHO[c.desfecho] ?? c.desfecho : "",
      c.objecoes.map((o) => NOMES_OBJECAO[o] ?? o).join(", "), c.cumprimentoPct, c.pontosRever, c.resumo ?? c.motivoDescarte ?? "", c.ficheiro]));
}

function LinhaChamada({ c, onAbrir, mostrarItem }: { c: ChamadaLinha; onAbrir: (id: number) => void; mostrarItem?: boolean }) {
  return (
    <li className="border-t first:border-t-0">
      <button className="w-full py-2.5 text-left hover:bg-muted/40 px-1 -mx-1 rounded" onClick={() => onAbrir(c.id)}>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="tabular-nums text-muted-foreground">{dataHora(c.dataHora)} · {duracao(c.duracaoS)} · {c.telefone ?? "—"}</span>
          <span className="flex items-center gap-1.5">
            {c.tipo && <Badge variant="outline" className="text-[10px] font-normal">{NOMES_TIPO[c.tipo]}</Badge>}
            {c.estado !== "analisada" && <Badge variant="secondary" className="text-[10px] font-normal">{NOMES_ESTADO[c.estado] ?? c.estado}</Badge>}
            {c.estado === "analisada" && <span className={cn("tabular-nums font-semibold", corPct(c.cumprimentoPct))}>{pctTxt(c.cumprimentoPct)}</span>}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-snug line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{c.resumo || c.motivoDescarte || "Sem resumo."}</p>
        {mostrarItem && c.item?.evidencia && (
          <p className="mt-1 text-[11px] text-muted-foreground italic line-clamp-2">“{c.item.evidencia}” · confiança {Math.round(c.item.confianca * 100)}%</p>
        )}
      </button>
    </li>
  );
}

function ChamadasDoFiltro({ de, ate, filtro, onAbrir }: { de: string; ate: string; filtro: Filtro; onAbrir: (id: number) => void }) {
  const q = useChamadas(de, ate, { tipo: filtro.tipo, item: filtro.item, res: filtro.res });
  return (
    <>
      <SheetHeader>
        <SheetTitle>{filtro.titulo}</SheetTitle>
        <SheetDescription>{q.data ? `${q.data.total} chamadas` : "A carregar…"} · {de.slice(8)}/{de.slice(5, 7)} a {ate.slice(8)}/{ate.slice(5, 7)}</SheetDescription>
      </SheetHeader>
      <div className="mt-3 flex justify-end">
        {q.data && q.data.total > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportarChamadas(`chamadas-${de}-a-${ate}`, q.data.chamadas)}><Download className="mr-1 h-3 w-3" />Exportar Excel</Button>
        )}
      </div>
      {q.isLoading && <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-muted-foreground" />}
      {q.data && q.data.total === 0 && <p className="mt-6 text-sm text-muted-foreground">Nenhuma chamada.</p>}
      {q.data && <ul className="mt-2">{q.data.chamadas.map((c) => <LinhaChamada key={c.id} c={c} onAbrir={onAbrir} mostrarItem={Boolean(filtro.item)} />)}</ul>}
    </>
  );
}

function ListaChamadas({ de, ate, onAbrir }: { de: string; ate: string; onAbrir: (id: number) => void }) {
  const [todas, setTodas] = useState(false);
  const q = useChamadas(de, ate, { estado: todas ? "todas" : "analisada" });
  return (
    <Seccao
      titulo={q.data ? `${q.data.total} chamadas` : "Chamadas"}
      acao={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
            Mostrar também as não analisadas
          </label>
          {q.data && q.data.total > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportarChamadas(`chamadas-${de}-a-${ate}`, q.data.chamadas)}><Download className="mr-1 h-3 w-3" />Exportar Excel</Button>
          )}
        </div>
      }
    >
      {q.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
      {q.data && q.data.total === 0 && <Vazio />}
      {q.data && <ul>{q.data.chamadas.map((c) => <LinhaChamada key={c.id} c={c} onAbrir={onAbrir} />)}</ul>}
    </Seccao>
  );
}

// ---------------------------------------------------------------------------

function DetalheChamada({ id, voltar }: { id: number; voltar?: () => void }) {
  const q = useChamada(id);
  const [verTranscricao, setVerTranscricao] = useState(false);
  const t = useTranscricao(id, verTranscricao);
  const c = q.data;

  const ordem = { nao_cumprido: 0, cumprido: 1, nao_aplicavel: 2 } as Record<string, number>;
  const resultados = c ? [...c.resultados].sort((a, b) => Number(b.rever) - Number(a.rever) || (ordem[a.estado] ?? 3) - (ordem[b.estado] ?? 3)) : [];

  return (
    <>
      <SheetHeader>
        {voltar && <button onClick={voltar} className="mb-1 w-fit text-xs text-muted-foreground hover:text-foreground">← Voltar à lista</button>}
        <SheetTitle>{c ? `${dataHora(c.dataHora)} · ${c.colaborador}` : "Chamada"}</SheetTitle>
        <SheetDescription>
          {c && <>{c.tipo ? NOMES_TIPO[c.tipo] : NOMES_ESTADO[c.estado] ?? c.estado} · {duracao(c.duracaoS)} · {c.telefone ?? "—"}</>}
        </SheetDescription>
      </SheetHeader>
      {q.isLoading && <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-muted-foreground" />}
      {c && (
        <div className="mt-4 space-y-4">
          <audio controls preload="none" src={urlAudio(c.id)} className="w-full" />

          <div>
            <p className="text-sm leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>{c.resumo || c.motivoDescarte || "Sem resumo."}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.desfecho && <Badge variant="outline" className="text-[10px] font-normal">{NOMES_DESFECHO[c.desfecho] ?? c.desfecho}</Badge>}
              {c.objecoes.map((o) => <Badge key={o} variant="secondary" className="text-[10px] font-normal">Objeção: {NOMES_OBJECAO[o] ?? o}</Badge>)}
            </div>
          </div>

          {resultados.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pontos do guião</h3>
              <ul className="space-y-2">
                {resultados.map((p) => (
                  <li key={p.item} className="rounded border px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm">{p.validacao}<span className="ml-1.5 text-[11px] text-muted-foreground">{p.seccao}</span></span>
                      <EstadoPonto estado={p.estado} rever={p.rever} />
                    </div>
                    {p.evidencia && <p className="mt-1 text-xs italic text-muted-foreground">“{p.evidencia}”</p>}
                    {p.estado !== "nao_aplicavel" && <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">confiança {Math.round(p.confianca * 100)}%</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setVerTranscricao((v) => !v)}>
              <FileText className="mr-1 h-3 w-3" />{verTranscricao ? "Esconder transcrição" : "Ver transcrição"}
            </Button>
            {verTranscricao && (
              <div className="mt-2 max-h-96 overflow-y-auto rounded border bg-muted/30 p-3 text-xs leading-relaxed">
                {t.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.isError && <p className="text-muted-foreground">Transcrição indisponível.</p>}
                {t.data?.linhas.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
          </div>
          {c.modelo && <p className="text-[10px] text-muted-foreground">Avaliado por {c.modelo}</p>}
        </div>
      )}
    </>
  );
}

function EstadoPonto({ estado, rever }: { estado: string; rever: boolean }) {
  if (rever) return <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">A rever</Badge>;
  if (estado === "cumprido") return <Badge className="shrink-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Cumpriu</Badge>;
  if (estado === "nao_cumprido") return <Badge className="shrink-0 bg-red-100 text-red-800 hover:bg-red-100 text-[10px]">Não cumpriu</Badge>;
  return <Badge variant="secondary" className="shrink-0 text-[10px]">Não se aplica</Badge>;
}
