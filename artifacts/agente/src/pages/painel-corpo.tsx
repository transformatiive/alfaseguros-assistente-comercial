import { Bloco, Indisponivel } from "@/components/Bloco";
import { Kpi } from "@/components/editorial";
import { hora } from "@/lib/formatos";
import { Agendamentos, BlocoDevolucoes, BlocoFollowUps, BlocoTickets } from "@/pages/blocos";
import { BlocoAcoes, BlocoCoaching } from "@/pages/blocos-acoes";
import {
  coachingDisponivel,
  estaDisponivel,
  type Acao,
  type AgentePainel,
  type Devolucao,
  type FollowUp,
  type TicketEmRisco,
} from "@/lib/tipos";

/**
 * The panel's body, shared by the real panel and the preview.
 *
 * **Two columns from 1024px, not one.** The single column was a constraint I
 * invented: `desk.topband` renders full screen, as the Zoho docs say and as
 * section 7A confirmed. Stacking eight blocks vertically on a wide screen
 * means the agent scrolls past their whole morning to see whether anything is
 * at the bottom.
 *
 * The split is by rhythm, not by size. The left column is the queue — things
 * with a customer waiting at the other end, read top to bottom and worked
 * through. The right column is context: what the day looked like, what the
 * model noticed. Mixing them makes both harder to scan.
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
  const conta = (b: unknown): number | "—" =>
    b === undefined ? "—" : estaDisponivel(b as never) ? (b as unknown[]).length : "—";

  const porDevolver = conta(painel?.devolucoes);
  const acoes = conta(painel?.acoes);
  const pedidos = conta(painel?.ticketsEmRisco);
  const seguimentos = conta(painel?.followUps);

  return (
    <div className="space-y-4">
      {/* Four numbers answer "how big is today" before any scrolling. Two
          columns on a phone, four once there is room — never a squashed row of
          four on 380px. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi valor={porDevolver} rotulo="Por devolver" alerta={porDevolver !== "—" && porDevolver > 0} />
        <Kpi valor={acoes} rotulo="Ações do dia" alerta={acoes !== "—" && acoes > 0} />
        <Kpi valor={pedidos} rotulo="Pedidos +24h" alerta={pedidos !== "—" && pedidos > 0} />
        <Kpi valor={seguimentos} rotulo="Seguimentos" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* ── A fila: alguém está à espera ─────────────────────────── */}
        <div className="space-y-4">
          <Bloco<Devolucao>
            titulo="Chamadas por devolver"
            cor="text-red-700"
            dados={painel?.devolucoes}
            aCarregar={aCarregar}
            vazio="Nenhuma chamada por devolver."
          >
            {(itens) => <BlocoDevolucoes itens={itens} somenteLeitura={somenteLeitura} />}
          </Bloco>

          <Bloco<Acao>
            titulo="Ações do dia"
            cor="text-red-700"
            dados={painel?.acoes}
            aCarregar={aCarregar}
            vazio="Nada por fazer das conversas deste dia."
          >
            {(itens) => <BlocoAcoes itens={itens} />}
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
        </div>

        {/* ── O contexto: como foi o dia ───────────────────────────── */}
        <div className="space-y-4">
          <Bloco<TicketEmRisco>
            titulo="Pedidos há mais de 24 h"
            cor="text-amber-700"
            dados={painel?.ticketsEmRisco}
            aCarregar={aCarregar}
            vazio="Nenhum pedido passou das 24 horas."
          >
            {(itens) => <BlocoTickets itens={itens} />}
          </Bloco>

          {coachingDisponivel(painel?.coaching) ? (
            <BlocoCoaching c={painel.coaching} />
          ) : painel?.coaching ? (
            <section className="space-y-2">
              <h2 className="t-micro px-0.5 text-stone-500">Leitura do dia</h2>
              <Indisponivel motivo={painel.coaching.motivo} />
            </section>
          ) : null}

          <Agendamentos motivo={painel?.agendamentos.motivo} />
        </div>
      </div>

      {painel && (
        <p className="t-micro px-0.5 font-normal text-stone-400">
          Atualizado às {hora(painel.atualizadoEm)}
        </p>
      )}
    </div>
  );
}
