import { BarChart3 } from "lucide-react";
import { Indisponivel } from "@/components/Bloco";
import { diaPorExtenso, haQuantoTempo, iniciais, primeiroNome, saudacao } from "@/lib/formatos";
import { BlocoCoaching } from "@/pages/blocos-acoes";
import { FecharamSozinhas, GrupoPorPrazo, SemTarefas } from "@/pages/tarefas";
import {
  agruparPorPrazo,
  coachingDisponivel,
  estaDisponivel,
  type AgentePainel,
  type Bloco,
  type Coaching,
  type Tarefa,
} from "@/lib/tipos";

/**
 * The panel's body, shared by the real panel and the preview.
 *
 * **Ordered by when, not by what.** The panel used to group by category —
 * calls here, quotes there, Desk tickets over there. That is the shape of
 * where the rows came from, and it is not the order anybody works in: nobody
 * decides to "do calls now", they do whatever is latest first. Two columns
 * sorted by type made that decision again on every scan.
 *
 * So the left column is an agenda: **Atrasado**, then **Hoje**, then **Esta
 * semana** — read top to bottom, and nothing is decided. The category is still
 * there, as the icon on each row, which is where it earns its keep.
 *
 * **The right column is context, not work.** The day's reading, how tasks
 * close themselves, and the count of what is parked. Everything there is read
 * once in the morning; nothing there is a thing to do.
 *
 * The masthead carries the three numbers that decide whether today is heavy.
 */

export function CorpoDoPainel({
  painel,
  aCarregar,
  somenteLeitura,
}: {
  painel: AgentePainel | undefined;
  aCarregar: boolean;
  /** The preview renders the same panel with nothing that writes. */
  somenteLeitura?: boolean;
}) {
  const agora = new Date();
  const piles = agruparPorPrazo(painel?.tarefas ?? [], agora);

  const bloco = painel?.coaching;
  const coaching = bloco && coachingDisponivel(bloco) ? bloco : null;
  const semCoaching = bloco && !coachingDisponivel(bloco) ? bloco : null;

  // A task list cannot say "we could not read your Desk" — a block that failed
  // simply contributes no rows, which on screen is indistinguishable from
  // having none. So the failures are named once, above everything, rather than
  // silently shrinking the list.
  const falhas = painel ? blocosEmFalha(painel) : [];

  if (aCarregar || !painel) return <Esqueleto />;

  const total = piles.atrasado.length + piles.hoje.length + piles.semana.length;

  return (
    <div className="space-y-4">
      <Masthead
        nome={painel.colaborador.nome}
        data={painel.data}
        atrasado={piles.atrasado.length}
        hoje={piles.hoje.length}
        aguardar={piles.aguardar.length}
        atualizadoEm={painel.atualizadoEm}
        agora={agora}
      />

      {falhas.length > 0 && (
        <div className="space-y-1.5">
          {falhas.map((m) => (
            <Indisponivel key={m} motivo={m} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {total === 0 && falhas.length === 0 ? (
            <SemTarefas />
          ) : (
            <>
              <GrupoPorPrazo
                balde="atrasado"
                tarefas={piles.atrasado}
                agora={agora}
                somenteLeitura={somenteLeitura}
              />
              <GrupoPorPrazo
                balde="hoje"
                tarefas={piles.hoje}
                agora={agora}
                somenteLeitura={somenteLeitura}
              />
              <GrupoPorPrazo
                balde="semana"
                tarefas={piles.semana}
                agora={agora}
                somenteLeitura={somenteLeitura}
              />
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-3">
          <LeituraDoDia c={coaching} motivo={semCoaching?.motivo} dia={painel.data} />
          <FecharamSozinhas fechadas={painel.fechadas ?? []} />
          <AAguardar tarefas={piles.aguardar} />
        </aside>
      </div>

      {coaching && <BlocoCoaching c={coaching} />}

      <p className="t-micro px-0.5 font-normal text-stone-400">
        Análise e prazos às 08:00 e 16:30 · verificação de evidência de 15 em 15 minutos ·
        {" "}
        {painel.tarefas.length} tarefas
      </p>
    </div>
  );
}

/**
 * Who, when, and how heavy — the three things read before any scrolling.
 *
 * The greeting is not decoration. This panel tells somebody what they failed
 * to do yet; opening on their own name, in their own language, is the
 * difference between a colleague's note and an audit. The date beside it is
 * what stops a preview of last Thursday being mistaken for this morning.
 *
 * Only the overdue count is coloured. Three red numbers is no number in red at
 * all, and this is the one that means a person is waiting.
 */
function Masthead({
  nome,
  data,
  atrasado,
  hoje,
  aguardar,
  atualizadoEm,
  agora,
}: {
  nome: string;
  data: string;
  atrasado: number;
  hoje: number;
  aguardar: number;
  atualizadoEm: string;
  agora: Date;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <BarChart3 className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="t-micro truncate text-stone-400">
            {diaPorExtenso(data)} · Agenda do dia
          </div>
          <h1 className="t-pagina truncate text-stone-900">
            {saudacao(agora)}, {primeiroNome(nome)}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex gap-5">
          <Numero
            valor={atrasado}
            rotulo="Atrasado"
            cor={atrasado > 0 ? "text-red-600" : undefined}
          />
          <Numero valor={hoje} rotulo="Hoje" />
          <Numero valor={aguardar} rotulo="A aguardar" cor="text-stone-500" />
        </div>
        <div className="flex items-center gap-3 border-l border-stone-200 pl-4">
          <span className="flex items-center gap-1.5 t-meta whitespace-nowrap text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Atualizado {haQuantoTempo(atualizadoEm, agora)}
          </span>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 t-meta font-bold text-indigo-700"
            title={nome}
          >
            {iniciais(nome)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Numero({ valor, rotulo, cor }: { valor: number; rotulo: string; cor?: string }) {
  return (
    <div className="text-center">
      <div className={`t-pagina tabular-nums ${cor ?? "text-stone-900"}`}>{valor}</div>
      <div className="t-micro whitespace-nowrap text-stone-400">{rotulo}</div>
    </div>
  );
}

/**
 * The day's one sentence, at the top of the rail — and *which* day it is about.
 *
 * The panel shows today; a reading of the day is written once the day is over.
 * Those are two different clocks, and pretending they are one produced a card
 * that every morning said the analysis had not run — true, and useless, since
 * what somebody wants at nine o'clock is yesterday's reading. So the reading
 * falls back to the most recent one and says so out loud: "Leitura de segunda,
 * 7 de setembro" is honest and still useful; the same words presented as
 * today's would be neither.
 */
function LeituraDoDia({
  c,
  motivo,
  dia,
}: {
  c: Coaching | null;
  motivo?: string;
  /** The day the panel itself is showing. */
  dia: string;
}) {
  if (c?.paragraphOverview) {
    const doProprioDia = c.data === dia;
    return (
      <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
        <h2 className="t-micro mb-1.5 text-indigo-700">
          {doProprioDia ? "Uma sugestão para hoje" : `Leitura de ${diaPorExtenso(c.data)}`}
        </h2>
        <p className="t-narrativa text-stone-700">{c.paragraphOverview}</p>
      </section>
    );
  }
  if (!motivo) return null;
  return <p className="px-0.5 t-meta text-stone-400">{motivo}</p>;
}

/**
 * What is parked, split by whose move it is.
 *
 * Deliberately a count and not a list. Nothing here is work for today — the
 * whole reason it is out of the agenda is that there is nothing to do about it
 * — and a list would put sixty rows of not-work under five rows of work.
 */
function AAguardar({ tarefas }: { tarefas: Tarefa[] }) {
  if (tarefas.length === 0) return null;
  const cliente = tarefas.filter((t) => t.categoria === "espera_cliente").length;
  const nosso = tarefas.length - cliente;

  return (
    <section className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <h2 className="t-micro mb-2 text-stone-500">
        A aguardar
        <span className="ml-1.5 tabular-nums opacity-60">{tarefas.length}</span>
      </h2>
      <div className="flex gap-2">
        <Balde valor={nosso} titulo="Contigo" nota="A bola está do lado da Alfa" tom="amber" />
        <Balde
          valor={cliente}
          titulo="Com o cliente"
          nota="Só relembrar se passar do prazo"
          tom="stone"
        />
      </div>
    </section>
  );
}

function Balde({
  valor,
  titulo,
  nota,
  tom,
}: {
  valor: number;
  titulo: string;
  nota: string;
  tom: "amber" | "stone";
}) {
  const cores =
    tom === "amber" ? "bg-amber-50 text-amber-700" : "bg-stone-100 text-stone-500";
  return (
    <div className={`flex-1 rounded-lg px-3 py-2 ${cores}`}>
      <div className="t-titulo tabular-nums">{valor}</div>
      <div className="t-meta font-semibold text-stone-700">{titulo}</div>
      <div className="t-meta text-stone-400">{nota}</div>
    </div>
  );
}

/** The `motivo` of every block that could not be built. */
function blocosEmFalha(p: AgentePainel): string[] {
  // Typed as `Bloco<unknown>`: the four blocks hold four different row types,
  // and all this needs from them is whether they are an array at all.
  const blocos: Bloco<unknown>[] = [p.devolucoes, p.ticketsEmRisco, p.followUps, p.acoes];
  const fora: string[] = [];
  for (const b of blocos) {
    if (!estaDisponivel(b)) fora.push(b.motivo);
  }
  // The same identity problem produces the same sentence on several blocks —
  // saying it four times is noise, not four pieces of information.
  return [...new Set(fora)];
}

function Esqueleto() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-xl bg-stone-200/70" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-72 animate-pulse rounded-xl bg-stone-200/70" />
        <div className="h-48 animate-pulse rounded-xl bg-stone-200/70" />
      </div>
    </div>
  );
}
