import { useMemo, useState } from "react";
import { format, startOfMonth, startOfWeek, subWeeks, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ExternalLink, Loader2, Phone, PhoneMissed, RefreshCw, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  linkLead,
  useAlertasVida,
  useColaboradorVida,
  useResumoVida,
  type AlertaVida,
  type EstadoAgenda,
  type PessoaNocrm,
  type ResumoVida,
  type Sincronizacao,
} from "@/lib/use-vida-pipeline";

/**
 * Painel do pipeline da equipa Vida (noCRM): previsto vs feito, desempenho por
 * pessoa, funil e alertas. Os dados vêm do espelho do noCRM, sincronizado pelo
 * n8n três vezes por dia útil.
 */

const ymd = (d: Date): string => format(d, "yyyy-MM-dd");

type Periodo = "semana" | "semana_passada" | "mes";

function periodo(p: Periodo): { de: string; ate: string; nome: string } {
  const hoje = new Date();
  if (p === "semana_passada") {
    const s = subWeeks(hoje, 1);
    return { de: ymd(startOfWeek(s, { weekStartsOn: 1 })), ate: ymd(endOfWeek(s, { weekStartsOn: 1 })), nome: "Semana passada" };
  }
  if (p === "mes") return { de: ymd(startOfMonth(hoje)), ate: ymd(hoje), nome: "Este mês" };
  return { de: ymd(startOfWeek(hoje, { weekStartsOn: 1 })), ate: ymd(hoje), nome: "Esta semana" };
}

const eur = (n: number): string => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) : null);
const diaCurto = (d: string): string => format(new Date(`${d}T12:00:00`), "EEE d", { locale: ptBR });

function rateColor(p: number | null): string {
  if (p === null) return "text-stone-400";
  if (p >= 80) return "text-green-600";
  if (p >= 60) return "text-amber-600";
  return "text-red-600";
}

const ESTADO: Record<EstadoAgenda, { label: string; cls: string }> = {
  feito: { label: "Feito", cls: "bg-green-50 text-green-700 border-green-200" },
  tentou: { label: "Tentou", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  nao_feito: { label: "Não feito", cls: "bg-red-50 text-red-700 border-red-200" },
  mais_logo: { label: "Mais logo", cls: "bg-stone-50 text-stone-500 border-stone-200" },
};

function LinkLead({ id, titulo }: { id: number; titulo: string }) {
  return (
    <a href={linkLead(id)} target="_blank" rel="noreferrer" className="text-stone-900 hover:underline inline-flex items-center gap-1">
      {titulo}
      <ExternalLink className="h-3 w-3 text-stone-400" />
    </a>
  );
}

function EstadoSync({ s }: { s: Sincronizacao | undefined }) {
  if (!s) return null;
  if (!s.ultimaCorridaEm) {
    return <span className="text-xs text-amber-700">Ainda sem dados do noCRM. A primeira sincronização ainda não correu.</span>;
  }
  const quando = format(new Date(s.ultimaCorridaEm), "d MMM, HH:mm", { locale: ptBR });
  const falhou = s.ultimoResultado && s.ultimoResultado.ok === false;
  return (
    <span className={`text-xs inline-flex items-center gap-1 ${falhou ? "text-amber-700" : "text-stone-500"}`}>
      <RefreshCw className="h-3 w-3" />
      noCRM lido às {quando}
      {falhou && s.ultimoResultado?.motivo ? ` · ${s.ultimoResultado.motivo}` : ""}
      {s.ultimoResultado?.leadsPorLer ? ` · ${s.ultimoResultado.leadsPorLer} leads com notas por ler` : ""}
    </span>
  );
}

function Kpi({ titulo, valor, nota, cor }: { titulo: string; valor: string; nota?: string; cor?: string }) {
  return (
    <Card className="border-stone-200">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-stone-500">{titulo}</div>
        <div className={`text-2xl mt-1 ${cor ?? "text-stone-900"}`} style={{ fontFamily: "Georgia, serif" }}>
          {valor}
        </div>
        {nota && <div className="text-xs text-stone-500 mt-0.5">{nota}</div>}
      </CardContent>
    </Card>
  );
}

function Secao({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <Card className="border-stone-200">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-stone-900">{titulo}</h3>
          {extra}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function BarrasDias({ dias }: { dias: { dia: string; previsto: number; feito: number; futuro?: boolean }[] }) {
  const max = Math.max(1, ...dias.map((d) => d.previsto));
  if (dias.length === 0) return <p className="text-sm text-stone-500">Sem dias úteis no período.</p>;
  return (
    <div className="flex items-end gap-2 h-36">
      {dias.map((d) => {
        const p = pct(d.feito, d.previsto);
        return (
          <div key={d.dia} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.feito} feitas de ${d.previsto} previstas`}>
            <div className={`text-[10px] ${rateColor(d.futuro ? null : p)}`}>{d.futuro || p === null ? "" : `${p}%`}</div>
            <div className="w-full flex-1 flex items-end">
              <div className="w-full bg-stone-100 rounded-sm relative" style={{ height: `${(d.previsto / max) * 100}%`, minHeight: d.previsto ? 4 : 0 }}>
                <div className="absolute bottom-0 inset-x-0 bg-stone-700 rounded-sm" style={{ height: `${d.previsto ? (d.feito / d.previsto) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="text-[10px] text-stone-500 truncate">{diaCurto(d.dia)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- equipa

function nomeDe(equipa: PessoaNocrm[], userId: number | null): { nome: string; naEquipa: boolean } {
  if (userId == null) return { nome: "Sem dono", naEquipa: false };
  const p = equipa.find((x) => x.userId === userId);
  return { nome: p?.nome ?? `Utilizador ${userId}`, naEquipa: p?.naEquipa ?? false };
}

function VistaEquipa({ r, onPessoa }: { r: ResumoVida; onPessoa: (id: number) => void }) {
  const cumprimento = pct(r.feito, r.previsto);
  const contacto = pct(r.primeiroContacto.noPrazo, r.primeiroContacto.avaliadas);
  const pessoas = [...r.pessoas]
    .map((p) => ({ ...p, ...nomeDe(r.equipa, p.userId) }))
    .filter((p) => p.carteira + p.previsto + p.vendas + p.conversas + p.tentativas > 0)
    .sort((a, b) => Number(b.naEquipa) - Number(a.naEquipa) || a.nome.localeCompare(b.nome, "pt"));
  const totalPerda = r.motivosPerda.reduce((s, m) => s + m.n, 0);

  return (
    <div className="space-y-4">
      {r.colaboradoresSemNocrm.length > 0 && (
        <div className="rounded-md bg-amber-50 border-l-2 border-amber-400 px-3 py-2 text-xs text-stone-700">
          <strong>{r.colaboradoresSemNocrm.length} pessoas da equipa Vida sem ligação ao noCRM</strong> (o email não bate certo):{" "}
          {r.colaboradoresSemNocrm.map((c) => c.nome).join(", ")}.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi titulo="Previsto vs feito" valor={cumprimento === null ? "—" : `${cumprimento}%`} nota={`${r.feito} de ${r.previsto} ações`} cor={rateColor(cumprimento)} />
        <Kpi titulo="Leads atrasadas" valor={String(r.atrasadas)} nota="próxima ação já passou" cor={r.atrasadas > 0 ? "text-red-600" : undefined} />
        <Kpi titulo="1.º contacto em 2 h" valor={contacto === null ? "—" : `${contacto}%`} nota={`${r.primeiroContacto.noPrazo} de ${r.primeiroContacto.avaliadas} leads novas`} cor={rateColor(contacto)} />
        <Kpi titulo="Alertas abertos" valor={String(r.totalAlertas)} cor={r.totalAlertas > 0 ? "text-amber-600" : undefined} />
        <Kpi titulo="Leads novas" valor={String(r.leadsNovas)} />
        <Kpi titulo="Simulações · propostas" valor={`${r.simulacoes} · ${r.propostas}`} />
        <Kpi titulo="Vendas" valor={String(r.vendas)} nota={eur(r.premio)} cor="text-green-700" />
        <Kpi titulo="Perdidas" valor={String(r.perdidas)} />
      </div>

      <Secao titulo="Previsto vs feito por dia" extra={<span className="text-xs text-stone-500">barra clara = previsto · escura = feito</span>}>
        <BarrasDias dias={r.dias} />
      </Secao>

      <Secao titulo="Por pessoa">
        {pessoas.length === 0 ? (
          <p className="text-sm text-stone-500">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
                  <th className="text-left py-2 pr-2 font-normal">Pessoa</th>
                  <th className="text-right px-2 font-normal">Carteira</th>
                  <th className="text-right px-2 font-normal">Previsto</th>
                  <th className="text-right px-2 font-normal">Feito</th>
                  <th className="text-right px-2 font-normal">Tentou</th>
                  <th className="text-right px-2 font-normal">Não feito</th>
                  <th className="text-right px-2 font-normal">Atrasadas</th>
                  <th className="text-right px-2 font-normal">Conversas</th>
                  <th className="text-right px-2 font-normal">Tentativas</th>
                  <th className="text-right px-2 font-normal">Vendas</th>
                  <th className="text-right pl-2 font-normal">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {pessoas.map((p) => {
                  const c = pct(p.feito, p.previsto);
                  return (
                    <tr key={String(p.userId)} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 pr-2">
                        {p.userId != null ? (
                          <button className="text-stone-900 hover:underline text-left" onClick={() => onPessoa(p.userId as number)}>
                            {p.nome}
                          </button>
                        ) : (
                          <span className="text-stone-500">{p.nome}</span>
                        )}
                        {p.userId != null && !p.naEquipa && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-stone-200 text-stone-500">fora da equipa</Badge>
                        )}
                      </td>
                      <td className="text-right px-2 tabular-nums">{p.carteira}</td>
                      <td className="text-right px-2 tabular-nums">{p.previsto}</td>
                      <td className="text-right px-2 tabular-nums">
                        {p.feito} {c !== null && <span className={`text-xs ${rateColor(c)}`}>({c}%)</span>}
                      </td>
                      <td className="text-right px-2 tabular-nums text-amber-700">{p.tentou}</td>
                      <td className="text-right px-2 tabular-nums text-red-600">{p.naoFeito}</td>
                      <td className={`text-right px-2 tabular-nums ${p.atrasadas > 0 ? "text-red-600" : ""}`}>{p.atrasadas}</td>
                      <td className="text-right px-2 tabular-nums">{p.conversas}</td>
                      <td className="text-right px-2 tabular-nums text-stone-500">{p.tentativas}</td>
                      <td className="text-right px-2 tabular-nums">{p.vendas}</td>
                      <td className={`text-right pl-2 tabular-nums ${p.alertas > 0 ? "text-amber-600" : ""}`}>{p.alertas}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <div className="grid md:grid-cols-3 gap-4">
        <Secao titulo="Funil (leads abertas)">
          <div className="space-y-2">
            {r.funil.map((f) => (
              <div key={f.passo} className="text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-700">{f.passo}</span>
                  <span className="tabular-nums">{f.total}</span>
                </div>
                {f.paradas > 0 && (
                  <div className="text-xs text-red-600">
                    {f.paradas} paradas há mais de {r.prazos[f.passo] ?? "?"} dias
                  </div>
                )}
              </div>
            ))}
            {r.funil.length === 0 && <p className="text-sm text-stone-500">Sem leads abertas.</p>}
          </div>
        </Secao>
        <Secao titulo="Motivos de perda">
          <div className="space-y-2">
            {r.motivosPerda.map((m) => (
              <div key={m.motivo} className="text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-700">{m.motivo}</span>
                  <span className="tabular-nums">{m.n}</span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 mt-1">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(m.n / Math.max(1, totalPerda)) * 100}%` }} />
                </div>
              </div>
            ))}
            {r.motivosPerda.length === 0 && <p className="text-sm text-stone-500">Sem leads perdidas no período.</p>}
          </div>
        </Secao>
        <Secao titulo="Origens (leads fechadas)">
          <div className="space-y-2">
            {r.origens.slice(0, 10).map((o) => (
              <div key={o.origem} className="flex justify-between text-sm">
                <span className="text-stone-700 truncate pr-2">{o.origem}</span>
                <span className="tabular-nums shrink-0">
                  {o.ganhas}/{o.fechadas} <span className="text-xs text-stone-500">({pct(o.ganhas, o.fechadas)}%)</span>
                </span>
              </div>
            ))}
            {r.origens.length === 0 && <p className="text-sm text-stone-500">Sem leads fechadas no período.</p>}
          </div>
        </Secao>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- colaborador

function duracao(seg: number | null): string {
  if (seg == null) return "registada à mão";
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function VistaColaborador({ equipa, userId, setUserId }: { equipa: PessoaNocrm[]; userId: number | null; setUserId: (id: number) => void }) {
  const [dia, setDia] = useState(ymd(new Date()));
  const { data, isLoading, error } = useColaboradorVida(userId, dia);
  const opcoes = [...equipa].filter((p) => p.ativo).sort((a, b) => Number(b.naEquipa) - Number(a.naEquipa) || a.nome.localeCompare(b.nome, "pt"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm"
          value={userId ?? ""}
          onChange={(e) => setUserId(Number(e.target.value))}
        >
          <option value="" disabled>
            Escolher pessoa…
          </option>
          {opcoes.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.nome}
              {p.naEquipa ? "" : " (fora da equipa)"}
            </option>
          ))}
        </select>
        <input type="date" className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
      </div>

      {userId == null && <p className="text-sm text-stone-500">Escolha uma pessoa para ver a agenda, as chamadas e as leads em atraso.</p>}
      {isLoading && userId != null && <Loader2 className="h-5 w-5 animate-spin text-stone-400" />}
      {error && <p className="text-sm text-red-600">Não foi possível carregar os dados desta pessoa.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi titulo="Carteira aberta" valor={String(data.carteira)} />
            <Kpi
              titulo={`Agenda de ${diaCurto(data.dia)}`}
              valor={`${data.agenda.filter((a) => a.estado === "feito").length}/${data.agenda.length}`}
              nota="feitas / previstas"
            />
            <Kpi titulo="Atrasadas" valor={String(data.atrasadas.length)} cor={data.atrasadas.length > 0 ? "text-red-600" : undefined} />
            <Kpi titulo="Paradas no passo" valor={String(data.paradas.length)} cor={data.paradas.length > 0 ? "text-amber-600" : undefined} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Secao titulo="Agenda do dia">
              {data.agenda.length === 0 ? (
                <p className="text-sm text-stone-500">Sem ações previstas neste dia (ou a agenda ainda não foi fotografada).</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.agenda.map((a) => (
                    <li key={a.leadId} className="py-2 flex items-center gap-3 text-sm">
                      <span className="w-12 text-stone-500 tabular-nums">{a.hora ?? "—"}</span>
                      <span className="flex-1 min-w-0 truncate">
                        <LinkLead id={a.leadId} titulo={a.titulo} />
                        {a.passo && <span className="text-xs text-stone-500"> · {a.passo}</span>}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ${ESTADO[a.estado].cls}`}>{ESTADO[a.estado].label}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            <Secao titulo="Últimas 4 semanas">
              <BarrasDias dias={data.dias} />
            </Secao>
          </div>

          <Secao titulo={`Chamadas de ${diaCurto(data.dia)}`} extra={<span className="text-xs text-stone-500">{data.chamadas.filter((c) => c.conversa).length} conversas · {data.chamadas.filter((c) => c.tentativa).length} tentativas</span>}>
            {data.chamadas.length === 0 ? (
              <p className="text-sm text-stone-500">Sem chamadas registadas no noCRM neste dia.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data.chamadas.map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <div className="flex items-center gap-3">
                      {c.tentativa ? <PhoneMissed className="h-4 w-4 text-stone-400" /> : <Phone className="h-4 w-4 text-green-600" />}
                      <span className="w-12 text-stone-500 tabular-nums">{format(new Date(c.ocorreuEm), "HH:mm")}</span>
                      <span className="flex-1 min-w-0 truncate">
                        <LinkLead id={c.leadId} titulo={c.titulo} />
                      </span>
                      <span className="text-xs text-stone-500">{c.tentativa ? "sem resposta" : duracao(c.duracaoSeg)}</span>
                      {c.gravacaoUrl && (
                        <a href={c.gravacaoUrl} target="_blank" rel="noreferrer" className="text-xs text-stone-600 hover:underline">
                          gravação
                        </a>
                      )}
                    </div>
                    {c.resumo && (
                      <p className="mt-1 ml-[4.75rem] text-xs text-stone-600 leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
                        {c.resumo}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <div className="grid md:grid-cols-2 gap-4">
            <Secao titulo="Leads atrasadas">
              {data.atrasadas.length === 0 ? (
                <p className="text-sm text-stone-500">Nenhuma.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.atrasadas.slice(0, 30).map((l) => (
                    <li key={l.leadId} className="py-1.5 flex justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <LinkLead id={l.leadId} titulo={l.titulo} />
                      </span>
                      <span className="text-xs text-red-600 shrink-0">{l.proximaAcaoDia ? diaCurto(l.proximaAcaoDia) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            <Secao titulo="Paradas no passo">
              {data.paradas.length === 0 ? (
                <p className="text-sm text-stone-500">Nenhuma.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.paradas.slice(0, 30).map((l) => (
                    <li key={l.leadId} className="py-1.5 flex justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <LinkLead id={l.leadId} titulo={l.titulo} />
                        <span className="text-xs text-stone-500"> · {l.passo}</span>
                      </span>
                      <span className="text-xs text-amber-700 shrink-0">
                        {l.dias} d (prazo {l.prazo ?? "?"})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </div>

          {data.alertas.length > 0 && (
            <Secao titulo="Alertas">
              <ListaAlertas alertas={data.alertas} mostrarPessoa={false} />
            </Secao>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- alertas

function ListaAlertas({ alertas, mostrarPessoa }: { alertas: AlertaVida[]; mostrarPessoa: boolean }) {
  return (
    <ul className="divide-y divide-stone-100">
      {alertas.map((a) => (
        <li key={`${a.tipo}:${a.leadId}`} className="py-2 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-800">{a.nome}</Badge>
            <LinkLead id={a.leadId} titulo={a.titulo} />
            {a.passo && <span className="text-xs text-stone-500">· {a.passo}</span>}
            {mostrarPessoa && <span className="text-xs text-stone-500 ml-auto">{a.pessoa ?? "Sem dono"}</span>}
          </div>
          <p className="text-xs text-stone-600 mt-0.5">{a.fazer}</p>
        </li>
      ))}
    </ul>
  );
}

function VistaAlertas() {
  const { data, isLoading, error } = useAlertasVida();
  const [tipo, setTipo] = useState<string | null>(null);
  const lista = useMemo(() => (data ? data.alertas.filter((a) => !tipo || a.tipo === tipo) : []), [data, tipo]);

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-stone-400" />;
  if (error || !data) return <p className="text-sm text-red-600">Não foi possível carregar os alertas.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTipo(null)}
          className={`text-xs px-2.5 py-1 rounded-full border ${tipo === null ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600"}`}
        >
          Todos ({data.alertas.length})
        </button>
        {Object.entries(data.tipos).map(([k, nome]) => (
          <button
            key={k}
            onClick={() => setTipo(k)}
            className={`text-xs px-2.5 py-1 rounded-full border ${tipo === k ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600"}`}
          >
            {nome} ({data.porTipo[k] ?? 0})
          </button>
        ))}
      </div>
      <Secao titulo="Leads a precisar de atenção">
        {lista.length === 0 ? <p className="text-sm text-stone-500">Sem alertas.</p> : <ListaAlertas alertas={lista} mostrarPessoa />}
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------- página

export default function VidaPipeline() {
  const [p, setP] = useState<Periodo>("semana");
  const [aba, setAba] = useState("equipa");
  const [userId, setUserId] = useState<number | null>(null);
  const per = periodo(p);
  const { data, isLoading, error } = useResumoVida(per.de, per.ate);

  const abrirPessoa = (id: number): void => {
    setUserId(id);
    setAba("colaborador");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-stone-500" />
            Equipa Vida · Pipeline
          </h1>
          <div className="mt-1">
            <EstadoSync s={data?.sincronizacao} />
          </div>
        </div>
        <div className="flex gap-1">
          {(["semana", "semana_passada", "mes"] as Periodo[]).map((k) => (
            <button
              key={k}
              onClick={() => setP(k)}
              className={`text-xs px-2.5 py-1 rounded-md border ${p === k ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:bg-stone-50"}`}
            >
              {periodo(k).nome}
            </button>
          ))}
        </div>
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="equipa">Visão da equipa</TabsTrigger>
          <TabsTrigger value="colaborador">Colaborador</TabsTrigger>
          <TabsTrigger value="alertas">
            Alertas
            {data && data.totalAlertas > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {data.totalAlertas}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipa" className="mt-4">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin text-stone-400" />}
          {error && <p className="text-sm text-red-600">Não foi possível carregar o painel.</p>}
          {data && <VistaEquipa r={data} onPessoa={abrirPessoa} />}
        </TabsContent>
        <TabsContent value="colaborador" className="mt-4">
          <VistaColaborador equipa={data?.equipa ?? []} userId={userId} setUserId={setUserId} />
        </TabsContent>
        <TabsContent value="alertas" className="mt-4">
          <VistaAlertas />
        </TabsContent>
      </Tabs>
    </div>
  );
}
