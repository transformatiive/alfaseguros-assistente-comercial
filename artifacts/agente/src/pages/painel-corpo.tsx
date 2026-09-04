import { Bloco, Indisponivel } from "@/components/Bloco";
import { Kpi, TiraDeIndicadores } from "@/components/editorial";
import { hora } from "@/lib/formatos";
import { Agendamentos, BlocoDevolucoes, BlocoFollowUps, BlocoTickets } from "@/pages/blocos";
import { BlocoAcoes, BlocoCoaching, FaixaDoDia } from "@/pages/blocos-acoes";
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
 *
 * Above both sits the masthead — the four counts and the day's one sentence,
 * side by side. That sentence used to sit at the bottom of the right column,
 * under sixty ticket rows, which is a summary nobody reads as a summary.
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

  // Narrowed here rather than inline so the masthead can both *lay out* for the
  // banner and *render* it without repeating the guard — and so the band takes
  // the whole width, instead of sitting next to an empty box, when there is no
  // analysis for this day.
  const bloco = painel?.coaching;
  const coaching = bloco && coachingDisponivel(bloco) ? bloco : null;
  const semCoaching = bloco && !coachingDisponivel(bloco) ? bloco : null;
  const leitura = coaching?.paragraphOverview ? coaching : null;

  return (
    <div className="space-y-4">
      {/* The masthead: how big today is, and what it was like — read together,
          before any scrolling.

          The narrative used to live at the bottom of the right column, under
          sixty ticket rows. A summary read after the detail is not a summary,
          so it comes up here beside the numbers. The two share a row on a wide
          screen and stack on a phone; the paragraph gets the wider half
          because a line of prose at 640px is unreadable. */}
      <div
        className={
          leitura
            ? "grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-stretch"
            : ""
        }
      >
        <TiraDeIndicadores largo={!leitura}>
          {/* Only a count that means somebody is waiting right now is red.
              Thirty-one actions is a morning's work, not an emergency, and
              painting it the same red as an unreturned call teaches the agent
              to ignore both. */}
          <Kpi
            valor={porDevolver}
            rotulo="Por devolver"
            tom={porDevolver !== "—" && porDevolver > 0 ? "alerta" : "normal"}
          />
          <Kpi
            valor={pedidos}
            rotulo="Pedidos +24h"
            tom={pedidos !== "—" && pedidos > 0 ? "aviso" : "normal"}
          />
          <Kpi valor={acoes} rotulo="Ações do dia" />
          <Kpi valor={seguimentos} rotulo="Seguimentos" />
        </TiraDeIndicadores>

        {leitura && <FaixaDoDia c={leitura} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* ── A fila: alguém está à espera ─────────────────────────── */}
        <div className="min-w-0 space-y-4">
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
        <div className="min-w-0 space-y-4">
          <Bloco<TicketEmRisco>
            titulo="Pedidos há mais de 24 h"
            cor="text-amber-700"
            dados={painel?.ticketsEmRisco}
            aCarregar={aCarregar}
            vazio="Nenhum pedido passou das 24 horas."
          >
            {(itens) => <BlocoTickets itens={itens} />}
          </Bloco>

        </div>
      </div>

      {/* Below both columns, not inside one.

          The queue is roughly as tall as the ticket list; the coaching is not,
          and hanging it off the right column left the left one dead-ending
          halfway down the page with eighteen hundred pixels of nothing beside
          it. Full width it balances the two and reads better besides. */}
      {coaching ? (
        <BlocoCoaching c={coaching} />
      ) : semCoaching ? (
        <section className="space-y-2">
          <h2 className="t-micro px-0.5 text-stone-500">Leitura do dia</h2>
          <Indisponivel motivo={semCoaching.motivo} />
        </section>
      ) : null}

      <Agendamentos motivo={painel?.agendamentos.motivo} />

      {painel && (
        <p className="t-micro px-0.5 font-normal text-stone-400">
          Atualizado às {hora(painel.atualizadoEm)}
        </p>
      )}
    </div>
  );
}
