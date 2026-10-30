import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, Loader2, PhoneIncoming, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  useEquipa360,
  useVisaoGeral,
  type Equipa360Response,
  type EquipaAnalise,
  type FiltroEquipa,
  type Totais,
  type VisaoGeralResponse,
} from "@/lib/use-analise-chamadas";

/* ------------------------------------------------------------------ */
/* Colour targets (approved by Nuno, 30/10/2026)                       */
/* ------------------------------------------------------------------ */

type Nivel = "bom" | "atencao" | "mau" | "neutro";

const COR_TEXTO: Record<Nivel, string> = {
  bom: "text-green-700",
  atencao: "text-amber-700",
  mau: "text-red-700",
  neutro: "text-stone-800",
};
const COR_BARRA: Record<Nivel, string> = {
  bom: "bg-green-600",
  atencao: "bg-amber-500",
  mau: "bg-red-600",
  neutro: "bg-stone-300",
};

/** Higher is better: green from `bom`, amber from `atencao`, red below. */
function nivelMaior(v: number | null, bom: number, atencao: number): Nivel {
  if (v === null) return "neutro";
  return v >= bom ? "bom" : v >= atencao ? "atencao" : "mau";
}
/** Lower is better: green up to `bom`, amber up to `atencao`, red above. */
function nivelMenor(v: number | null, bom: number, atencao: number): Nivel {
  if (v === null) return "neutro";
  return v <= bom ? "bom" : v <= atencao ? "atencao" : "mau";
}

const METAS = {
  atendidas: (v: number | null) => nivelMaior(v, 90, 80),
  espera: (v: number | null) => nivelMenor(v, 20, 30),
  insistentes: (v: number | null) => nivelMenor(v, 3, 6),
  conversasReais: (v: number | null) => nivelMaior(v, 50, 35),
  /** AI quality is 1–5; 85% / 70% of the scale, same as the guião targets. */
  qualidade: (v: number | null) => nivelMaior(v, 4.25, 3.5),
  semTicket: (v: number | null) => nivelMenor(v, 5, 10),
};

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const fmtN = (n: number) => n.toLocaleString("pt-PT");
const fmtPct = (p: number | null) => (p === null ? "—" : `${Math.round(p)}%`);
function fmtSeg(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
const fmtDiaCurto = (d: string) => format(parseISO(d), "d MMM", { locale: pt });
const fmtDiaLongo = (d: string) => format(parseISO(d), "EEEE, d 'de' MMMM", { locale: pt });

/* ------------------------------------------------------------------ */
/* Period + team filters                                               */
/* ------------------------------------------------------------------ */

type Atalho = "ontem" | "7d" | "30d" | "datas";

const ontem = () => format(subDays(new Date(), 1), "yyyy-MM-dd");
const diasAtras = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

function periodoDoAtalho(a: Exclude<Atalho, "datas">): { de: string; ate: string } {
  if (a === "ontem") return { de: ontem(), ate: ontem() };
  if (a === "7d") return { de: diasAtras(7), ate: ontem() };
  return { de: diasAtras(30), ate: ontem() };
}

const ATALHOS: { id: Atalho; nome: string }[] = [
  { id: "ontem", nome: "Ontem" },
  { id: "7d", nome: "Últimos 7 dias" },
  { id: "30d", nome: "Últimos 30 dias" },
  { id: "datas", nome: "Datas…" },
];

const EQUIPAS: { id: FiltroEquipa; nome: string }[] = [
  { id: "todas", nome: "Todas as equipas" },
  { id: "360", nome: "Equipa 360 (com Sinistros)" },
  { id: "vida", nome: "Equipa Vida" },
  { id: "corporate", nome: "Corporate e restantes" },
];

const SUBMENU = [
  { id: "geral", nome: "Visão geral", fase: null },
  { id: "e360", nome: "Equipa 360", fase: null },
  { id: "vida", nome: "Equipa Vida", fase: 5 },
  { id: "campanha", nome: "Campanha Vida", fase: 4 },
  { id: "chamadas", nome: "Chamadas", fase: 6 },
] as const;
type Ecra = (typeof SUBMENU)[number]["id"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AnaliseChamadas() {
  const [ecra, setEcra] = useState<Ecra>("geral");
  const [atalho, setAtalho] = useState<Atalho>("30d");
  const [datas, setDatas] = useState(() => periodoDoAtalho("30d"));
  const [equipa, setEquipa] = useState<FiltroEquipa>("todas");

  const periodo = atalho === "datas" ? datas : periodoDoAtalho(atalho);
  const datasInvalidas = atalho === "datas" && (!datas.de || !datas.ate || datas.de > datas.ate);
  const q = useVisaoGeral(periodo.de, periodo.ate, equipa);
  const q360 = useEquipa360(periodo.de, periodo.ate, ecra === "e360" && !datasInvalidas);
  const atual = SUBMENU.find((s) => s.id === ecra)!;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Title + period */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold text-stone-900">Análise de Chamadas</h1>
            <p className="text-sm text-stone-500">Todas as chamadas do Ringover, por equipa.</p>
          </div>
          <div role="group" aria-label="Período" className="flex flex-wrap gap-1">
            {ATALHOS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={atalho === a.id}
                onClick={() => {
                  if (a.id === "datas") setDatas(periodo);
                  setAtalho(a.id);
                }}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  atalho === a.id
                    ? "bg-stone-900 text-white border-stone-900"
                    : "bg-white text-stone-700 border-stone-200 hover:bg-stone-50"
                }`}
              >
                {a.nome}
              </button>
            ))}
          </div>
        </div>

        {atalho === "datas" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-stone-500">De</span>
              <input
                type="date"
                value={datas.de}
                max={datas.ate || undefined}
                onChange={(e) => setDatas((d) => ({ ...d, de: e.target.value }))}
                className="border border-stone-200 rounded-md px-2 py-1 bg-white"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-stone-500">até</span>
              <input
                type="date"
                value={datas.ate}
                min={datas.de || undefined}
                onChange={(e) => setDatas((d) => ({ ...d, ate: e.target.value }))}
                className="border border-stone-200 rounded-md px-2 py-1 bg-white"
              />
            </label>
            {datasInvalidas && <span className="text-red-700 text-xs">A data inicial tem de ser anterior à final.</span>}
          </div>
        )}

        {/* Sub-menu */}
        <nav aria-label="Vistas" className="flex gap-1 overflow-x-auto border-b border-stone-200">
          {SUBMENU.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={ecra === s.id ? "page" : undefined}
              onClick={() => setEcra(s.id)}
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                ecra === s.id
                  ? "border-amber-500 text-stone-900 font-medium"
                  : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              {s.nome}
            </button>
          ))}
        </nav>

        {datasInvalidas ? null : ecra === "geral" ? (
          <VisaoGeral q={q} equipa={equipa} setEquipa={setEquipa} />
        ) : ecra === "e360" ? (
          <Equipa360 q={q360} />
        ) : (
          <EmConstrucao nome={atual.nome} fase={atual.fase} />
        )}
      </div>
    </div>
  );
}

function EmConstrucao({ nome, fase }: { nome: string; fase: number | null }) {
  return (
    <Card className="border-dashed border-stone-300">
      <CardContent className="p-8 text-center text-stone-600">
        <div className="font-medium text-stone-900">{nome}</div>
        <p className="text-sm mt-1">
          Este ecrã chega na fase {fase} do plano. Para já, use a Visão geral e escolha a equipa.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Visão geral                                                         */
/* ------------------------------------------------------------------ */

function VisaoGeral({
  q,
  equipa,
  setEquipa,
}: {
  q: ReturnType<typeof useVisaoGeral>;
  equipa: FiltroEquipa;
  setEquipa: (e: FiltroEquipa) => void;
}) {
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Equipa" className="flex flex-wrap gap-1.5">
        {EQUIPAS.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={equipa === e.id}
            onClick={() => setEquipa(e.id)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              equipa === e.id
                ? "bg-amber-100 text-amber-900 border-amber-300"
                : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
            }`}
          >
            {e.nome}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className="flex items-center gap-2 text-stone-500 py-16 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> A carregar as chamadas…
        </div>
      ) : q.isError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-5 flex items-start gap-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Não foi possível carregar a análise.</div>
              <div className="mt-1">{q.error.message}</div>
              <button type="button" onClick={() => q.refetch()} className="mt-2 underline">
                Tentar outra vez
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Conteudo d={q.data} equipa={equipa} aAtualizar={q.isFetching} />
      )}
    </div>
  );
}

function Conteudo({ d, equipa, aAtualizar }: { d: VisaoGeralResponse; equipa: FiltroEquipa; aAtualizar: boolean }) {
  const semDados = d.kpis.recebidas + d.kpis.feitas === 0;
  return (
    <div className={`space-y-4 transition-opacity ${aAtualizar ? "opacity-70" : ""}`}>
      <AvisoCobertura d={d} equipa={equipa} />

      {semDados ? (
        <Card className="border-stone-200">
          <CardContent className="p-8 text-center text-stone-600 text-sm">
            <PhoneIncoming className="h-5 w-5 mx-auto mb-2 text-stone-400" />
            {d.cobertura.aSincronizar
              ? "Ainda não há chamadas guardadas para este período. A buscar ao Ringover…"
              : "Não houve chamadas neste período para esta equipa."}
          </CardContent>
        </Card>
      ) : (
        <>
          <Kpis d={d} />
          <div className="grid gap-4 lg:grid-cols-2">
            <VolumeDiario d={d} />
            <RespostaPorHora d={d} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ResultadosRecebidas d={d} />
            <PorEquipa d={d} />
          </div>
          <PorColaborador d={d} />
        </>
      )}
    </div>
  );
}

function AvisoCobertura({ d, equipa }: { d: VisaoGeralResponse; equipa: FiltroEquipa }) {
  const { diasEmFalta, aSincronizar } = d.cobertura;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
      <span>
        {fmtDiaCurto(d.de)} a {fmtDiaCurto(d.ate)}
        {equipa !== "todas" && " · chamadas sem pessoa atribuída só entram em “Todas as equipas”"}
      </span>
      {diasEmFalta > 0 && (
        <span className="flex items-center gap-1 text-amber-700">
          {aSincronizar ? <RefreshCw className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
          {aSincronizar
            ? `A buscar ${diasEmFalta} ${diasEmFalta === 1 ? "dia" : "dias"} ao Ringover. A página atualiza sozinha.`
            : `Faltam ${diasEmFalta} ${diasEmFalta === 1 ? "dia" : "dias"} deste período. Tente mais tarde.`}
        </span>
      )}
    </div>
  );
}

/* KPI tiles --------------------------------------------------------- */

function Kpis({ d }: { d: VisaoGeralResponse }) {
  const k = d.kpis;
  const tiles: { nome: string; valor: string; nivel: Nivel; barra: number | null; nota: string }[] = [
    { nome: "Recebidas", valor: fmtN(k.recebidas), nivel: "neutro", barra: null, nota: `${fmtN(k.clientes)} clientes diferentes` },
    { nome: "Feitas", valor: fmtN(k.feitas), nivel: "neutro", barra: null, nota: `${fmtN(k.feitasAtendidas)} atendidas pelo cliente` },
    {
      nome: "Recebidas atendidas",
      valor: fmtPct(k.atendidasPct),
      nivel: METAS.atendidas(k.atendidasPct),
      barra: k.atendidasPct,
      nota: "Meta 90% · alerta abaixo de 80%",
    },
    {
      nome: "Espera média",
      valor: fmtSeg(k.esperaMediaS),
      nivel: METAS.espera(k.esperaMediaS),
      barra: k.esperaMediaS === null ? null : Math.min(100, (k.esperaMediaS / 60) * 100),
      nota: "Até atender · meta 20 s · alerta acima de 30 s",
    },
    { nome: "Duração média", valor: fmtSeg(k.duracaoMediaS), nivel: "neutro", barra: null, nota: "Das chamadas atendidas" },
    {
      nome: "Clientes que insistem",
      valor: fmtPct(k.clientesInsistentesPct),
      nivel: METAS.insistentes(k.clientesInsistentesPct),
      barra: k.clientesInsistentesPct,
      nota: "Ligaram 3 ou mais vezes · meta 3%",
    },
  ];
  return (
    <section aria-label="Indicadores" className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t, i) => (
        <Card
          key={t.nome}
          className="border-stone-200 animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-both hover:shadow-md transition-shadow"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <CardContent className="p-4">
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.nome}</div>
            <div
              className={`mt-1 text-2xl sm:text-3xl tabular-nums ${COR_TEXTO[t.nivel]}`}
              style={{ fontFamily: "Georgia, serif" }}
            >
              {t.valor}
            </div>
            {t.barra !== null && (
              <div className="mt-2 h-1 rounded bg-stone-100 overflow-hidden">
                <div className={`h-full ac-grow-x ${COR_BARRA[t.nivel]}`} style={{ width: `${t.barra}%` }} />
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-stone-500 leading-snug">{t.nota}</div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/* Charts ------------------------------------------------------------ */

function Bloco({ titulo, sub, children, atraso = 0 }: { titulo: string; sub: string; children: React.ReactNode; atraso?: number }) {
  return (
    <Card
      className="min-w-0 border-stone-200 animate-in fade-in duration-500 fill-mode-both"
      style={{ animationDelay: `${atraso}ms` }}
    >
      <CardContent className="p-4 sm:p-5">
        <h2 className="font-medium text-stone-900">{titulo}</h2>
        <p className="text-xs text-stone-500 mb-3">{sub}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** Tooltip shown on hover/focus of a bar. Anchored inside the chart so it never widens the page. */
function Dica({ texto, lado }: { texto: string; lado: "esq" | "meio" | "dir" }) {
  const pos = lado === "esq" ? "left-0" : lado === "dir" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full mb-1 ${pos} z-10 hidden group-hover:block group-focus:block w-max max-w-[220px] rounded bg-stone-900 px-2 py-1 text-[11px] leading-snug text-white shadow animate-in fade-in duration-150`}
    >
      {texto}
    </span>
  );
}

function ladoDe(i: number, n: number): "esq" | "meio" | "dir" {
  if (i < n * 0.2) return "esq";
  if (i >= n * 0.8) return "dir";
  return "meio";
}

function VolumeDiario({ d }: { d: VisaoGeralResponse }) {
  // Long periods: the last 31 days keep bars readable; the KPIs cover the whole period.
  const dias = d.porDia.slice(-31);
  const max = Math.max(1, ...dias.map((x) => x.recebidas + x.feitas));
  const cortado = d.porDia.length > dias.length;
  return (
    <Bloco
      titulo="Volume diário de chamadas"
      sub={cortado ? `Últimos ${dias.length} dias do período` : "Dias úteis, e fins de semana com chamadas"}
      atraso={100}
    >
      <div className="ac-chart flex items-end gap-[3px] h-40 border-b border-stone-200">
        {dias.map((x, i) => (
          <div
            key={x.dia}
            tabIndex={0}
            className="ac-bar group relative flex-1 h-full flex flex-col justify-end outline-none"
            aria-label={`${fmtDiaLongo(x.dia)}: ${x.recebidas} recebidas, ${x.feitas} feitas`}
          >
            <Dica
              texto={`${fmtDiaLongo(x.dia)}: ${fmtN(x.recebidas)} recebidas (${fmtN(x.recebidasAtendidas)} atendidas), ${fmtN(x.feitas)} feitas`}
              lado={ladoDe(i, dias.length)}
            />
            <div
              className="ac-grow-y bg-stone-700 rounded-t-sm"
              style={{ height: `${(x.feitas / max) * 100}%`, animationDelay: `${i * 20}ms` }}
            />
            <div
              className="ac-grow-y bg-amber-500"
              style={{ height: `${(x.recebidas / max) * 100}%`, animationDelay: `${i * 20}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] text-stone-500 pt-1">
        <span>{dias.length ? fmtDiaCurto(dias[0].dia) : ""}</span>
        <span>{dias.length ? fmtDiaCurto(dias[dias.length - 1].dia) : ""}</span>
      </div>
      <Legenda itens={[{ cor: "bg-amber-500", nome: "Recebidas" }, { cor: "bg-stone-700", nome: "Feitas" }]} />
    </Bloco>
  );
}

function RespostaPorHora({ d }: { d: VisaoGeralResponse }) {
  return (
    <Bloco titulo="Taxa de resposta por hora" sub="Chamadas recebidas atendidas por uma pessoa" atraso={150}>
      <div className="ac-chart flex items-end gap-1 h-40 border-b border-stone-200">
        {d.porHora.map((h, i) => {
          const nivel = METAS.atendidas(h.pct);
          return (
            <div
              key={h.hora}
              tabIndex={0}
              className="ac-bar group relative flex-1 h-full flex flex-col justify-end outline-none"
              aria-label={`${h.hora}h: ${fmtPct(h.pct)} atendidas`}
            >
              <Dica
                texto={
                  h.recebidas
                    ? `${h.hora}h: ${fmtN(h.atendidas)} de ${fmtN(h.recebidas)} atendidas (${fmtPct(h.pct)})`
                    : `${h.hora}h: sem chamadas recebidas`
                }
                lado={ladoDe(i, d.porHora.length)}
              />
              <div className={`text-[10px] text-center font-semibold mb-0.5 ${COR_TEXTO[nivel]}`}>
                {h.pct === null ? "" : Math.round(h.pct)}
              </div>
              <div
                className={`ac-grow-y rounded-t-sm ${COR_BARRA[nivel]}`}
                style={{ height: `${(h.pct ?? 0) * 0.85}%`, animationDelay: `${i * 30}ms` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 pt-1">
        {d.porHora.map((h) => (
          <div key={h.hora} className="flex-1 text-center text-[10px] text-stone-500">
            {h.hora}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-stone-500 mt-2">Verde 90% ou mais · laranja 80 a 89% · vermelho abaixo de 80%</p>
    </Bloco>
  );
}

const COR_RESULTADO: Record<string, string> = {
  atendidas: "bg-green-600",
  caixa_voz: "bg-amber-500",
  nao_atendidas: "bg-red-600",
};

function ResultadosRecebidas({ d }: { d: VisaoGeralResponse }) {
  const total = d.kpis.recebidas;
  return (
    <Bloco titulo="O que acontece às chamadas recebidas" sub={`${fmtN(total)} chamadas recebidas`} atraso={200}>
      {total === 0 ? (
        <p className="text-sm text-stone-500">Sem chamadas recebidas neste período.</p>
      ) : (
        <>
          <div className="ac-chart flex h-6 rounded overflow-hidden">
            {d.resultadosRecebidas
              .filter((r) => r.total > 0)
              .map((r, i, arr) => (
                <div
                  key={r.id}
                  tabIndex={0}
                  className={`ac-bar ac-grow-x group relative outline-none ${COR_RESULTADO[r.id]}`}
                  style={{ width: `${(r.total / total) * 100}%` }}
                >
                  <Dica texto={`${r.nome}: ${fmtN(r.total)} (${fmtPct(r.pct)})`} lado={i === 0 ? "esq" : i === arr.length - 1 ? "dir" : "meio"} />
                </div>
              ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {d.resultadosRecebidas.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-sm shrink-0 ${COR_RESULTADO[r.id]}`} />
                <span className="flex-1 text-stone-700">{r.nome}</span>
                <span className="tabular-nums text-stone-500">{fmtN(r.total)}</span>
                <b className="tabular-nums w-12 text-right">{fmtPct(r.pct)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </Bloco>
  );
}

function Legenda({ itens }: { itens: { cor: string; nome: string }[] }) {
  return (
    <div className="flex gap-4 text-[11px] text-stone-600 mt-2">
      {itens.map((i) => (
        <span key={i.nome} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${i.cor}`} />
          {i.nome}
        </span>
      ))}
    </div>
  );
}

/* Tables ------------------------------------------------------------ */

function LinhaTotais({ t }: { t: Totais }) {
  const nAt = METAS.atendidas(t.atendidasPct);
  const nEs = METAS.espera(t.esperaMediaS);
  return (
    <>
      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmtN(t.recebidas)}</td>
      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmtN(t.feitas)}</td>
      <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap font-semibold ${COR_TEXTO[nAt]}`}>{fmtPct(t.atendidasPct)}</td>
      <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap ${COR_TEXTO[nEs]}`}>{fmtSeg(t.esperaMediaS)}</td>
      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmtSeg(t.duracaoMediaS)}</td>
    </>
  );
}

const CABECALHO_TOTAIS = ["Recebidas", "Feitas", "Atendidas", "Espera", "Duração"];

function PorEquipa({ d }: { d: VisaoGeralResponse }) {
  return (
    <Bloco titulo="Por equipa" sub="Sempre todas as equipas, para comparar" atraso={250}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[460px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
              <th className="text-left py-2 px-2 font-medium">Equipa</th>
              {CABECALHO_TOTAIS.map((c) => (
                <th key={c} className="text-right py-2 px-2 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.porEquipa.map((e) => (
              <tr key={e.id} className={`border-b border-stone-100 hover:bg-stone-50 ${e.id === d.equipa ? "bg-amber-50" : ""}`}>
                <td className={`py-2 px-2 ${e.id === "sem_agente" ? "text-stone-500" : "font-medium text-stone-900"}`}>{e.nome}</td>
                <LinhaTotais t={e} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

const NOME_EQUIPA_CURTO: Record<EquipaAnalise, string> = {
  "360": "360",
  vida: "Vida",
  corporate: "Corporate",
  sem_agente: "—",
};

function PorColaborador({ d }: { d: VisaoGeralResponse }) {
  const [todos, setTodos] = useState(false);
  const lista = useMemo(() => (todos ? d.porColaborador : d.porColaborador.slice(0, 12)), [d.porColaborador, todos]);
  if (d.porColaborador.length === 0) return null;
  return (
    <Bloco titulo="Por colaborador" sub="Ordenado por número de chamadas" atraso={300}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
              <th className="text-left py-2 px-2 font-medium">Colaborador</th>
              <th className="text-left py-2 px-2 font-medium">Equipa</th>
              {CABECALHO_TOTAIS.map((c) => (
                <th key={c} className="text-right py-2 px-2 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.agenteId} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="py-2 px-2 font-medium text-stone-900">{p.nome}</td>
                <td className="py-2 px-2 text-stone-500">{NOME_EQUIPA_CURTO[p.equipa]}</td>
                <LinhaTotais t={p} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.porColaborador.length > 12 && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="mt-2 text-xs text-amber-800 underline">
          {todos ? "Mostrar menos" : `Mostrar todos (${d.porColaborador.length})`}
        </button>
      )}
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */
/* Equipa 360                                                          */
/* ------------------------------------------------------------------ */

const fmtNota = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-PT", { minimumFractionDigits: 1 })} / 5`);

const COR_SEVERIDADE: Record<"alta" | "media" | "baixa", string> = {
  alta: "bg-red-600",
  media: "bg-amber-500",
  baixa: "bg-stone-400",
};

const COR_RESULTADO_360: Record<Equipa360Response["resultados"][number]["id"], string> = {
  won: "bg-green-600",
  open: "bg-sky-600",
  unknown: "bg-stone-400",
  lost: "bg-red-600",
  sem_ticket: "bg-amber-500",
};

function Equipa360({ q }: { q: ReturnType<typeof useEquipa360> }) {
  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-stone-500 py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> A carregar a análise da equipa 360…
      </div>
    );
  }
  if (q.isError) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-5 flex items-start gap-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Não foi possível carregar a análise.</div>
            <div className="mt-1">{q.error.message}</div>
            <button type="button" onClick={() => q.refetch()} className="mt-2 underline">
              Tentar outra vez
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const d = q.data;
  const k = d.kpis;
  if (k.conversas === 0) {
    return (
      <Card className="border-stone-200">
        <CardContent className="p-8 text-center text-stone-600 text-sm">
          A IA não analisou conversas da equipa 360 neste período.
        </CardContent>
      </Card>
    );
  }
  const tiles: { nome: string; valor: string; nivel: Nivel; nota: string }[] = [
    { nome: "Conversas", valor: fmtN(k.conversas), nivel: "neutro", nota: `${fmtN(k.analisadas)} analisadas pela IA` },
    { nome: "Qualidade média", valor: fmtNota(k.qualidadeMedia), nivel: METAS.qualidade(k.qualidadeMedia), nota: "Nota da IA · meta 4,3 · alerta abaixo de 3,5" },
    { nome: "Com falha grave", valor: fmtPct(k.comDesvioAltoPct), nivel: "neutro", nota: "Falha de severidade alta" },
    { nome: "Sem ticket no Desk", valor: fmtPct(k.semTicketPct), nivel: METAS.semTicket(k.semTicketPct), nota: "Meta 5% · alerta acima de 10%" },
    { nome: "Risco alto de perder", valor: fmtPct(k.riscoAltoPct), nivel: "neutro", nota: "Segundo a IA" },
    { nome: "Precisam de seguimento", valor: fmtPct(k.followUpPct), nivel: "neutro", nota: "A IA pede um contacto de volta" },
  ];
  const totalRes = d.resultados.reduce((s, r) => s + r.conversas, 0);

  return (
    <div className={`space-y-4 transition-opacity ${q.isFetching ? "opacity-70" : ""}`}>
      <p className="text-xs text-stone-500">
        {fmtDiaCurto(d.de)} a {fmtDiaCurto(d.ate)} · conversas analisadas pela IA na corrida diária · inclui Sinistros
      </p>
      <section aria-label="Indicadores da equipa 360" className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t, i) => (
          <Card
            key={t.nome}
            className="border-stone-200 animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-both hover:shadow-md transition-shadow"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <CardContent className="p-4">
              <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.nome}</div>
              <div className={`mt-1 text-2xl sm:text-3xl tabular-nums ${COR_TEXTO[t.nivel]}`} style={{ fontFamily: "Georgia, serif" }}>
                {t.valor}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500 leading-snug">{t.nota}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Falhas mais comuns ao procedimento" sub="% das conversas analisadas em que a IA encontrou a falha" atraso={100}>
          {d.falhas.length === 0 ? (
            <p className="text-sm text-stone-500">A IA não encontrou falhas neste período.</p>
          ) : (
            <div className="ac-chart space-y-2">
              {d.falhas.map((f, i) => (
                <div key={f.titulo} tabIndex={0} className="ac-bar group relative flex items-center gap-2 outline-none">
                  <Dica texto={`${f.titulo}: ${fmtN(f.conversas)} conversas (${fmtPct(f.pct)}) · gravidade ${f.severidade}`} lado="esq" />
                  <span className="w-40 sm:w-56 shrink-0 text-[13px] text-stone-800 leading-tight">{f.titulo}</span>
                  <span className="flex-1 h-3 rounded bg-stone-100 overflow-hidden">
                    <span
                      className={`block h-full ac-grow-x ${COR_SEVERIDADE[f.severidade]}`}
                      style={{ width: `${f.pct ?? 0}%`, animationDelay: `${i * 40}ms` }}
                    />
                  </span>
                  <b className="w-11 text-right tabular-nums text-sm">{fmtPct(f.pct)}</b>
                </div>
              ))}
              <Legenda
                itens={[
                  { cor: COR_SEVERIDADE.alta, nome: "Grave" },
                  { cor: COR_SEVERIDADE.media, nome: "Média" },
                  { cor: COR_SEVERIDADE.baixa, nome: "Leve" },
                ]}
              />
            </div>
          )}
        </Bloco>

        <Bloco titulo="Como acabaram as conversas" sub="Ligação entre a conversa e o ticket do Desk" atraso={150}>
          <div className="ac-chart flex h-6 rounded overflow-hidden">
            {d.resultados
              .filter((r) => r.conversas > 0)
              .map((r, i, arr) => (
                <div
                  key={r.id}
                  tabIndex={0}
                  className={`ac-bar ac-grow-x group relative outline-none ${COR_RESULTADO_360[r.id]}`}
                  style={{ width: `${(r.conversas / Math.max(1, totalRes)) * 100}%` }}
                >
                  <Dica texto={`${r.nome}: ${fmtN(r.conversas)} (${fmtPct(r.pct)})`} lado={i === 0 ? "esq" : i === arr.length - 1 ? "dir" : "meio"} />
                </div>
              ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {d.resultados.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-sm shrink-0 ${COR_RESULTADO_360[r.id]}`} />
                <span className="flex-1 text-stone-700">{r.nome}</span>
                <span className="tabular-nums text-stone-500">{fmtN(r.conversas)}</span>
                <b className="tabular-nums w-12 text-right">{fmtPct(r.pct)}</b>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-100 mt-4 pt-3">
            <div className="text-[11px] uppercase tracking-wide text-stone-500 mb-2">Porque ligam os clientes</div>
            <div className="ac-chart space-y-1.5">
              {d.motivos.map((m, i) => (
                <div key={m.nome} tabIndex={0} className="ac-bar group relative flex items-center gap-2 outline-none">
                  <Dica texto={`${m.nome}: ${fmtN(m.conversas)} conversas (${fmtPct(m.pct)})`} lado="esq" />
                  <span className="w-32 shrink-0 text-[13px] text-stone-800">{m.nome}</span>
                  <span className="flex-1 h-3 rounded bg-stone-100 overflow-hidden">
                    <span className="block h-full ac-grow-x bg-stone-700" style={{ width: `${m.pct ?? 0}%`, animationDelay: `${i * 40}ms` }} />
                  </span>
                  <b className="w-11 text-right tabular-nums text-sm">{fmtPct(m.pct)}</b>
                </div>
              ))}
            </div>
          </div>
        </Bloco>
      </div>

      <Bloco titulo="Por colaborador · Equipa 360" sub="Ordenado por número de conversas" atraso={200}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
                <th className="text-left py-2 px-2 font-medium">Colaborador</th>
                <th className="text-right py-2 px-2 font-medium">Conversas</th>
                <th className="text-right py-2 px-2 font-medium">Qualidade</th>
                <th className="text-right py-2 px-2 font-medium">Falhas graves</th>
                <th className="text-right py-2 px-2 font-medium">Sem ticket</th>
                <th className="text-right py-2 px-2 font-medium">Risco alto</th>
              </tr>
            </thead>
            <tbody>
              {d.porColaborador.map((p) => (
                <tr key={p.agenteId} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="py-2 px-2 font-medium text-stone-900">{p.nome}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtN(p.conversas)}</td>
                  <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap font-semibold ${COR_TEXTO[METAS.qualidade(p.qualidadeMedia)]}`}>
                    {fmtNota(p.qualidadeMedia)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtN(p.desviosAltos)}</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${COR_TEXTO[METAS.semTicket(p.semTicketPct)]}`}>{fmtPct(p.semTicketPct)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtN(p.riscoAlto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>

      {d.piores.length > 0 && (
        <Bloco titulo="Conversas para rever na reunião" sub="Nota da IA de 3 ou menos, as mais baixas primeiro" atraso={250}>
          <ul className="divide-y divide-stone-100">
            {d.piores.map((p) => (
              <li key={p.id}>
                <Link href={`/conversas/${p.id}`} className="block py-2.5 hover:bg-stone-50 rounded px-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className={`font-semibold tabular-nums ${COR_TEXTO[METAS.qualidade(p.qualidade)]}`}>{p.qualidade}/5</span>
                    <span className="font-medium text-stone-900">{p.agente}</span>
                    <span className="text-stone-500 text-xs">
                      {fmtDiaCurto(p.dia)} · {p.categoria}
                    </span>
                  </div>
                  <p className="text-[13px] text-stone-600 mt-0.5 line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>
                    {p.resumo}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Bloco>
      )}
    </div>
  );
}
