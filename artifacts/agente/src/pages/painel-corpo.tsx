import { Bloco } from "@/components/Bloco";
import { Kpi, TiraDeIndicadores } from "@/components/editorial";
import { hora } from "@/lib/formatos";
import { Agendamentos, BlocoDevolucoes, BlocoFollowUps, BlocoTickets } from "@/pages/blocos";
import { estaDisponivel, type AgentePainel, type Devolucao, type FollowUp, type TicketEmRisco } from "@/lib/tipos";

/**
 * The panel's body, shared by the real panel and the preview.
 *
 * Both routes render this exact component, so the screen being reviewed is the
 * screen that ships. The only difference either side may pass is
 * `somenteLeitura` and its own header line.
 */
export function CorpoDoPainel({
  painel,
  aCarregar,
  somenteLeitura,
}: {
  painel: AgentePainel | undefined;
  aCarregar: boolean;
  somenteLeitura?: boolean;
}) {
  const conta = <T,>(b: AgentePainel[keyof AgentePainel] | undefined): number | "—" => {
    if (!b) return "—";
    return estaDisponivel(b as never) ? (b as T[]).length : "—";
  };

  const porDevolver = conta<Devolucao>(painel?.devolucoes);
  const pedidos = conta<TicketEmRisco>(painel?.ticketsEmRisco);
  const seguimentos = conta<FollowUp>(painel?.followUps);

  return (
    <div className="space-y-4">
      {/* The strip is the editorial signature and it earns its place: three
          numbers answer "how big is today" before any scrolling happens. */}
      <TiraDeIndicadores>
        <Kpi valor={porDevolver} rotulo="Por devolver" alerta={porDevolver !== "—" && porDevolver > 0} />
        <Kpi valor={pedidos} rotulo="Pedidos +24h" alerta={pedidos !== "—" && pedidos > 0} />
        <Kpi valor={seguimentos} rotulo="Seguimentos" />
      </TiraDeIndicadores>

      <Bloco<Devolucao>
        titulo="Chamadas por devolver"
        cor="text-red-700"
        dados={painel?.devolucoes}
        aCarregar={aCarregar}
        vazio="Nenhuma chamada por devolver."
      >
        {(itens) => <BlocoDevolucoes itens={itens} somenteLeitura={somenteLeitura} />}
      </Bloco>

      <Bloco<TicketEmRisco>
        titulo="Pedidos há mais de 24 h"
        cor="text-amber-700"
        dados={painel?.ticketsEmRisco}
        aCarregar={aCarregar}
        vazio="Nenhum pedido passou das 24 horas."
      >
        {(itens) => <BlocoTickets itens={itens} />}
      </Bloco>

      <Bloco<FollowUp>
        titulo="Seguimentos"
        cor="text-blue-700"
        dados={painel?.followUps}
        aCarregar={aCarregar}
        vazio="Nenhum seguimento por fazer."
      >
        {(itens) => <BlocoFollowUps itens={itens} />}
      </Bloco>

      <Agendamentos motivo={painel?.agendamentos.motivo} />

      {painel && (
        <p className="px-0.5 text-[10px] uppercase tracking-wide text-stone-400">
          Atualizado às {hora(painel.atualizadoEm)}
        </p>
      )}
    </div>
  );
}
