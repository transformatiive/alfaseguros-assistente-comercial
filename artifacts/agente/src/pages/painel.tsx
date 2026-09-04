import { useQuery } from "@tanstack/react-query";
import { Bloco, Indisponivel } from "@/components/Bloco";
import { obter } from "@/lib/api";
import { hora } from "@/lib/formatos";
import { comDia, diaPedido } from "@/lib/dia";
import { Agendamentos, BlocoDevolucoes, BlocoFollowUps, BlocoTickets } from "@/pages/blocos";
import type { AgentePainel, Devolucao, FollowUp, TicketEmRisco } from "@/lib/tipos";

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
 *
 * The rows live in `blocos.tsx`, shared with the preview page, so the screen
 * being reviewed is the screen that ships.
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
    <div className="mx-auto max-w-xl space-y-5 p-3 pb-10">
      <Cabecalho painel={data} />

      <Bloco<Devolucao>
        titulo="Chamadas por devolver"
        dados={data?.devolucoes}
        aCarregar={isLoading}
        vazio="Nenhuma chamada por devolver hoje."
      >
        {(itens) => <BlocoDevolucoes itens={itens} />}
      </Bloco>

      <Bloco<TicketEmRisco>
        titulo="Pedidos há mais de 24 h"
        dados={data?.ticketsEmRisco}
        aCarregar={isLoading}
        vazio="Nenhum pedido teu passou das 24 horas."
      >
        {(itens) => <BlocoTickets itens={itens} />}
      </Bloco>

      <Bloco<FollowUp>
        titulo="Seguimentos"
        dados={data?.followUps}
        aCarregar={isLoading}
        vazio="Nenhum seguimento por fazer."
      >
        {(itens) => <BlocoFollowUps itens={itens} />}
      </Bloco>

      <Agendamentos motivo={data?.agendamentos.motivo} />

      {data && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Atualizado às {hora(data.atualizadoEm)}.
        </p>
      )}
    </div>
  );
}

function Cabecalho({ painel }: { painel: AgentePainel | undefined }) {
  return (
    <header className="px-1">
      <h1 className="font-serif text-xl leading-tight">O meu dia</h1>
      <p className="text-xs text-muted-foreground">{painel ? painel.colaborador.nome : " "}</p>
      {/* Only when it is NOT today: a panel showing another day must say so, or
          an empty Saturday reads as a quiet Monday. */}
      {painel && diaPedido() && (
        <p className="mt-0.5 text-xs font-medium">A mostrar {painel.data}, não hoje.</p>
      )}
    </header>
  );
}
