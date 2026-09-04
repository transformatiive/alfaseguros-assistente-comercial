import { useQuery } from "@tanstack/react-query";
import { Bloco, Indisponivel } from "@/components/Bloco";
import { Kpi, Faixa, Narrativa, TiraDeIndicadores } from "@/components/editorial";
import { obter } from "@/lib/api";
import { diaPorExtenso, hora, porqueMe, telefone } from "@/lib/formatos";
import { comDia, diaPedido } from "@/lib/dia";
import type { Devolucao, LinhaAgente, SupervisorPainel } from "@/lib/tipos";

/**
 * The coordinator's view: who is carrying what, and whether anything should
 * move.
 *
 * Every number here is built by running the agent panel per agent, so the
 * coordinator and the agent are never looking at two different truths about the
 * same day. The one number that is *not* a count — the weighted load — is shown
 * with the rule that produced it, because a ranking whose arithmetic is hidden
 * gets argued with instead of acted on.
 */
export function VistaDaEquipa({
  origem,
  chave,
}: {
  /**
   * Where to read from. Defaults to the token-guarded endpoint; the preview
   * page passes its own, which needs no token. The rendering is identical
   * either way — the point of a preview is to show the real screen.
   */
  origem?: string;
  chave?: unknown[];
} = {}) {
  const semToken = origem !== undefined;

  const { data, isLoading, error } = useQuery<SupervisorPainel>({
    queryKey: chave ?? ["equipa", diaPedido()],
    queryFn: async () => {
      if (!semToken) return obter<SupervisorPainel>(comDia("/api/supervisor/painel"));
      const res = await fetch(origem);
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`);
      return (await res.json()) as SupervisorPainel;
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar a vista da equipa." />
      </div>
    );
  }

  const maxCarga = data ? Math.max(1, ...data.agentes.map((a) => a.cargaPonderada)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-10 sm:p-4">
      <header className="px-0.5">
        <h1 className="t-display text-stone-900">
          A equipa
        </h1>
        <p className="t-micro text-stone-400">
          {data ? diaPorExtenso(data.data) : " "}
        </p>
      </header>

      <TiraDeIndicadores largo>
        <Kpi valor={data?.totais.devolucoes ?? "—"} rotulo="Por devolver" tom={data?.totais.devolucoes ? "alerta" : "normal"} />
        <Kpi valor={data?.totais.ticketsEmRisco ?? "—"} rotulo="Pedidos +24h" tom={data?.totais.ticketsEmRisco ? "aviso" : "normal"} />
        <Kpi valor={data?.totais.followUps ?? "—"} rotulo="Seguimentos" />
      </TiraDeIndicadores>

      {data && <Sugestao painel={data} />}

      <section className="space-y-1.5">
        <h2 className="px-0.5 t-micro text-stone-500">
          Carga por consultor
        </h2>
        {isLoading || !data ? (
          <div className="h-40 animate-pulse rounded-lg bg-stone-200/70" />
        ) : (
          <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {data.agentes.map((a) => (
              <LinhaCarga key={a.colaboradorId} a={a} max={maxCarga} />
            ))}
          </div>
        )}
        {data && (
          <p className="px-0.5 t-meta text-stone-400">
            Carga = chamadas ×{data.regra.pesos.devolucoes} + pedidos ×
            {data.regra.pesos.ticketsEmRisco} + seguimentos ×{data.regra.pesos.followUps}. Uma
            chamada que já virou pedido conta uma vez, não duas.
          </p>
        )}
      </section>

      <Bloco<Devolucao>
        titulo="Chamadas sem dono"
        cor="text-red-700"
        dados={data?.naoAtribuidas}
        aCarregar={isLoading}
        vazio="Todas as chamadas deste dia têm dono."
      >
        {(itens) => (
          <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {itens.map((d) => <LinhaSemDono key={d.ids.join("-")} d={d} />)}
          </div>
        )}
      </Bloco>

      {data && (
        <p className="px-0.5 t-micro text-stone-400">
          Atualizado às {hora(data.atualizadoEm)}
        </p>
      )}
    </div>
  );
}

function Sugestao({ painel }: { painel: SupervisorPainel }) {
  const { de, para, razao } = painel.sugestao;
  const haSugestao = de !== null && para !== null;

  // The prototype reserves the dark banner for the one sentence that matters
  // most on the screen. On the coordinator's view that is the redistribution
  // call: the only line asking them to actually do something.
  if (haSugestao) {
    return (
      <Faixa>
        <span className="not-italic font-semibold">{de.nome} → {para.nome}.</span> {razao}
      </Faixa>
    );
  }
  // The server always writes a sentence, including when it is not suggesting
  // anything. "Nothing to move" is an answer, and showing it beats an empty
  // card the coordinator has to interpret.
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <p className="t-meta text-stone-500">{razao}</p>
    </div>
  );
}

function LinhaCarga({ a, max }: { a: LinhaAgente; max: number }) {
  return (
    <div className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate t-body text-stone-900">{a.nome}</p>
        <p
          className="t-metric-sm shrink-0 text-stone-900"
        >
          {a.cargaPonderada.toFixed(1)}
        </p>
      </div>

      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full bg-amber-500"
          style={{ width: `${(a.cargaPonderada / max) * 100}%` }}
        />
      </div>

      <p className="mt-1.5 t-meta tabular-nums text-stone-400">
        {a.devolucoes} chamadas · {a.ticketsEmRisco} pedidos · {a.followUps} seguimentos
        {a.jaContadasComoTicket > 0 && (
          <>
            {" "}
            · {a.jaContadasComoTicket}{" "}
            {a.jaContadasComoTicket === 1 ? "já contada" : "já contadas"} como pedido
          </>
        )}
      </p>

      {a.indisponiveis.length > 0 && (
        <p className="mt-1 t-meta text-amber-700">
          Sem dados: {a.indisponiveis.join(", ")}. A carga dele está subestimada.
        </p>
      )}
    </div>
  );
}

function LinhaSemDono({ d }: { d: Devolucao }) {
  const razao = porqueMe(d.atribuicaoOrigem);
  return (
    <div className={d.tentativas > 1 ? "border-l-[3px] border-l-red-600 p-3" : "p-3"}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium tabular-nums text-stone-900">{telefone(d.numeroCliente)}</p>
        <p className="shrink-0 t-body tabular-nums text-stone-400">
          {hora(d.primeiraChamada)}
          {d.tentativas > 1 && <> – {hora(d.ultimaChamada)}</>}
        </p>
      </div>
      {d.tentativas > 1 && (
        <p className="mt-0.5 t-micro text-red-700">
          {d.tentativas} tentativas
        </p>
      )}
      {d.contexto && <Narrativa className="mt-1.5">{d.contexto}</Narrativa>}
      <p className="mt-1 t-meta text-stone-400">
        {razao ?? "Cliente sem pedidos anteriores — ninguém tem histórico com ele."}
      </p>
    </div>
  );
}
