import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { useEquipaVida } from "@/lib/use-analise-chamadas";
import { NOMES_TIPO, type TipoChamada } from "@/lib/use-chamadas-sftp";
import CampanhaVida from "./campanha-vida";

/**
 * Análise de Chamadas · Equipa Vida (fase 5). Em cima, o que o Ringover e o
 * noCRM dizem de cada pessoa; em baixo, as chamadas avaliadas com o mesmo
 * guião da campanha (o mesmo ecrã da Campanha Vida, com fonte Ringover).
 */

type Nivel = "bom" | "atencao" | "mau" | "neutro";
const COR: Record<Nivel, string> = {
  bom: "text-green-700",
  atencao: "text-amber-700",
  mau: "text-red-700",
  neutro: "text-stone-800",
};
const maior = (v: number | null, bom: number, at: number): Nivel => (v === null ? "neutro" : v >= bom ? "bom" : v >= at ? "atencao" : "mau");
const menor = (v: number | null, bom: number, at: number): Nivel => (v === null ? "neutro" : v <= bom ? "bom" : v <= at ? "atencao" : "mau");
const META = {
  reais: (v: number | null) => maior(v, 50, 35),
  guiao: (v: number | null) => maior(v, 85, 70),
  semLead: (v: number | null) => menor(v, 5, 10),
};

const fmtN = (n: number) => n.toLocaleString("pt-PT");
const fmtPct = (p: number | null) => (p === null ? "—" : `${Math.round(p)}%`);
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`);

export default function EquipaVida({ de, ate }: { de: string; ate: string }) {
  const q = useEquipaVida(de, ate, true);

  return (
    <div className="space-y-6">
      {q.isPending && (
        <div className="flex items-center gap-2 text-stone-500 py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> A carregar a equipa Vida…
        </div>
      )}
      {q.isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-5 flex items-start gap-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Não foi possível carregar a equipa Vida.</div>
              <button type="button" onClick={() => q.refetch()} className="mt-2 underline">Tentar outra vez</button>
            </div>
          </CardContent>
        </Card>
      )}
      {q.data && <Topo d={q.data} aAtualizar={q.isFetching} />}

      <section aria-label="Guião nas chamadas Ringover" className="space-y-2">
        <h2 className="text-sm font-semibold text-stone-900">Guião nas chamadas da equipa Vida</h2>
        <CampanhaVida de={de} ate={ate} fonte="ringover" embutido />
      </section>
    </div>
  );
}

function Topo({ d, aAtualizar }: { d: NonNullable<ReturnType<typeof useEquipaVida>["data"]>; aAtualizar: boolean }) {
  const k = d.kpis;
  const tiles: { nome: string; valor: string; nivel: Nivel; nota: string }[] = [
    { nome: "Chamadas feitas", valor: fmtN(k.feitas), nivel: "neutro", nota: `${fmtN(k.recebidas)} recebidas` },
    { nome: "Conversas reais", valor: fmtPct(k.conversasReaisPct), nivel: META.reais(k.conversasReaisPct), nota: `${fmtN(k.conversasReais)} com 30 s ou mais · meta 50%` },
    { nome: "Nota do guião", valor: fmtPct(k.guiaoPct), nivel: META.guiao(k.guiaoPct), nota: `${fmtN(k.avaliadas)} chamadas avaliadas · meta 85%` },
    { nome: "Ao telefone", valor: fmtMin(k.minutos), nivel: "neutro", nota: "Tempo em conversa no período" },
    {
      nome: "Sem lead no noCRM",
      valor: k.semLead === null ? "—" : fmtPct(k.semLeadPct),
      nivel: META.semLead(k.semLeadPct),
      nota: k.semLead === null ? "O noCRM ainda não tem chamadas neste período" : `${fmtN(k.semLead)} chamadas com gravação · meta 5%`,
    },
  ];

  return (
    <div className={`space-y-4 transition-opacity ${aAtualizar ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-stone-500">Rui e Hélio · Ringover, noCRM e guião da campanha</p>
        <Link href="/vida/pipeline" className="inline-flex items-center gap-1 text-xs text-blue-700 underline underline-offset-2">
          Ver o pipeline no noCRM <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <section aria-label="Indicadores da equipa Vida" className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.nome} className="border-stone-200">
            <CardContent className="p-4">
              <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.nome}</div>
              <div className={`mt-1 text-2xl sm:text-3xl tabular-nums ${COR[t.nivel]}`} style={{ fontFamily: "Georgia, serif" }}>{t.valor}</div>
              <div className="mt-1.5 text-[11px] text-stone-500 leading-snug">{t.nota}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="border-stone-200">
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-stone-900">Por colaborador</div>
          <div className="text-xs text-stone-500 mb-3">O ponto mais fraco é o ponto do guião com a nota mais baixa (mínimo 3 avaliações)</div>
          {d.porColaborador.length === 0 ? (
            <p className="text-sm text-stone-500">Sem chamadas da equipa Vida neste período.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
                    <th className="text-left py-2 px-2 font-medium">Colaborador</th>
                    <th className="text-right py-2 px-2 font-medium">Feitas</th>
                    <th className="text-right py-2 px-2 font-medium">Conversas reais</th>
                    <th className="text-right py-2 px-2 font-medium">Ao telefone</th>
                    <th className="text-right py-2 px-2 font-medium">Guião</th>
                    <th className="text-left py-2 px-2 font-medium">Ponto mais fraco</th>
                    <th className="text-right py-2 px-2 font-medium">Sem lead</th>
                  </tr>
                </thead>
                <tbody>
                  {d.porColaborador.map((p) => (
                    <tr key={p.agenteId} className="border-b border-stone-100 hover:bg-stone-50 align-top">
                      <td className="py-2 px-2 font-medium text-stone-900">{p.nome}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtN(p.feitas)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums ${COR[META.reais(p.conversasReaisPct)]}`}>{fmtPct(p.conversasReaisPct)}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmtMin(p.minutos)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-semibold ${COR[META.guiao(p.guiaoPct)]}`}>
                        {fmtPct(p.guiaoPct)}
                        <div className="text-[10px] font-normal text-stone-500">{fmtN(p.avaliadas)} aval.</div>
                      </td>
                      <td className="py-2 px-2 text-[13px] text-stone-700">
                        {p.pontoMaisFraco ? (
                          <>
                            {p.pontoMaisFraco.validacao}{" "}
                            <span className={`tabular-nums font-semibold ${COR[META.guiao(p.pontoMaisFraco.pct)]}`}>{fmtPct(p.pontoMaisFraco.pct)}</span>
                            <div className="text-[10px] text-stone-500">{NOMES_TIPO[p.pontoMaisFraco.tipo as TipoChamada] ?? p.pontoMaisFraco.tipo}</div>
                          </>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.semLead === null ? "—" : fmtN(p.semLead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
