import { useQuery } from "@tanstack/react-query";
import { Indisponivel } from "@/components/Bloco";
import { obter } from "@/lib/api";
import { comDia, diaPedido } from "@/lib/dia";
import { CorpoDoPainel } from "@/pages/painel-corpo";
import { diaPorExtenso } from "@/lib/formatos";
import type { AgentePainel } from "@/lib/tipos";

/**
 * The agent panel: what must I do today, in four blocks.
 *
 * Ordered by how much the customer is waiting, not by how interesting the data
 * is. Missed calls first — somebody rang and nobody answered, and that is the
 * only block where the customer has already noticed.
 *
 * Laid out narrow by default. It is rendered inside the Zoho Desk left panel,
 * which is roughly a phone's width; designing wide and letting it squash is how
 * you get a panel nobody uses.
 */
export function PainelDoAgente() {
  const { data, isLoading, error } = useQuery<AgentePainel>({
    queryKey: ["painel", diaPedido()],
    queryFn: () => obter<AgentePainel>(comDia("/api/agente/painel")),
    // Twice-daily server refresh; polling harder would cost requests and change
    // nothing. A stale minute here is invisible to the agent.
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar o painel. Se persistir, avisa o Nuno." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-3 pb-10">
      <header className="px-0.5">
        <h1 className="text-lg leading-tight text-stone-900" style={{ fontFamily: "Georgia, serif" }}>
          O meu dia
        </h1>
        <p className="text-[11px] uppercase tracking-wide text-stone-400">
          {data ? data.colaborador.nome : " "}
          {data && <> · {diaPorExtenso(data.data)}</>}
        </p>
      </header>

      <CorpoDoPainel painel={data} aCarregar={isLoading} />
    </div>
  );
}
