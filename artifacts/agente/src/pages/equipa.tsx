import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bloco, Indisponivel } from "@/components/Bloco";
import { obter } from "@/lib/api";
import { hora, porqueMe, telefone } from "@/lib/formatos";
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
export function VistaDaEquipa() {
  const { data, isLoading, error } = useQuery<SupervisorPainel>({
    queryKey: ["equipa", diaPedido()],
    queryFn: () => obter<SupervisorPainel>(comDia("/api/supervisor/painel")),
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
    <div className="mx-auto max-w-3xl space-y-5 p-3 pb-10">
      <header className="px-1">
        <h1 className="font-serif text-xl leading-tight">A equipa hoje</h1>
        {data && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {data.totais.devolucoes} chamadas · {data.totais.ticketsEmRisco} pedidos ·{" "}
            {data.totais.followUps} seguimentos
          </p>
        )}
        {data && diaPedido() && (
          <p className="mt-0.5 text-xs font-medium">
            A mostrar {data.data}, não hoje.
          </p>
        )}
      </header>

      {data && <Sugestao painel={data} />}

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">Carga por consultor</h2>
        {isLoading || !data ? (
          <Card className="h-40 animate-pulse bg-muted/40" />
        ) : (
          <Card className="divide-y p-0">
            {data.agentes.map((a) => (
              <LinhaCarga key={a.colaboradorId} a={a} max={maxCarga} />
            ))}
          </Card>
        )}
        {data && (
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Carga = chamadas ×{data.regra.pesos.devolucoes} + pedidos ×
            {data.regra.pesos.ticketsEmRisco} + seguimentos ×{data.regra.pesos.followUps}. Uma
            chamada que já virou pedido conta uma vez, não duas.
          </p>
        )}
      </section>

      <Bloco<Devolucao>
        titulo="Chamadas sem dono"
        dados={data?.naoAtribuidas}
        aCarregar={isLoading}
        vazio="Todas as chamadas de hoje têm dono."
      >
        {(itens) => itens.map((d) => <LinhaSemDono key={d.ids.join("-")} d={d} />)}
      </Bloco>

      {data && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Atualizado às {hora(data.atualizadoEm)}.
        </p>
      )}
    </div>
  );
}

function Sugestao({ painel }: { painel: SupervisorPainel }) {
  const { de, para, razao } = painel.sugestao;
  const haSugestao = de !== null && para !== null;

  return (
    <Card className={haSugestao ? "border-accent/60 bg-accent/5 p-3" : "bg-muted/30 p-3"}>
      {haSugestao && (
        <p className="text-sm font-medium">
          {de.nome} → {para.nome}
        </p>
      )}
      {/* The server always writes a sentence, including when it is not
          suggesting anything. "Nothing to move" is an answer, and showing it
          beats an empty card the coordinator has to interpret. */}
      <p className={haSugestao ? "mt-1 text-xs leading-relaxed" : "text-xs leading-relaxed"}>
        {razao}
      </p>
    </Card>
  );
}

function LinhaCarga({ a, max }: { a: LinhaAgente; max: number }) {
  return (
    <div className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{a.nome}</p>
        <p className="shrink-0 text-sm tabular-nums">{a.cargaPonderada.toFixed(1)}</p>
      </div>

      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${(a.cargaPonderada / max) * 100}%` }}
        />
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
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
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sem dados: {a.indisponiveis.join(", ")}. A carga dele está subestimada.
        </p>
      )}
    </div>
  );
}

function LinhaSemDono({ d }: { d: Devolucao }) {
  const razao = porqueMe(d.atribuicaoOrigem);
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium tabular-nums">{telefone(d.numeroCliente)}</p>
          <p className="text-xs text-muted-foreground">
            {hora(d.primeiraChamada)}
            {d.tentativas > 1 && <> · até às {hora(d.ultimaChamada)}</>}
          </p>
        </div>
        {d.tentativas > 1 && (
          <Badge variant="destructive" className="shrink-0">
            {d.tentativas} tentativas
          </Badge>
        )}
      </div>
      {d.contexto && (
        <p className="mt-2 font-serif text-xs leading-relaxed text-foreground/80">{d.contexto}</p>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {razao ?? "Cliente sem pedidos anteriores — ninguém tem histórico com ele."}
      </p>
    </Card>
  );
}
