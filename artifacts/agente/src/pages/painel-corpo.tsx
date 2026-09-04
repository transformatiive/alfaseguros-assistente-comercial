import { Indisponivel } from "@/components/Bloco";
import { Kpi, TiraDeIndicadores } from "@/components/editorial";
import { hora } from "@/lib/formatos";
import { Agendamentos } from "@/pages/blocos";
import { BlocoCoaching, FaixaDoDia } from "@/pages/blocos-acoes";
import { GrupoDeTarefas, SemTarefas } from "@/pages/tarefas";
import {
  agruparTarefas,
  coachingDisponivel,
  estaDisponivel,
  type AgentePainel,
  type Bloco,
  type CategoriaTarefa,
  type Tarefa,
} from "@/lib/tipos";

/**
 * The panel's body, shared by the real panel and the preview.
 *
 * **Organised by what the work asks of you, not by where it came from.** The
 * panel used to be one block per data source — calls, Desk tickets, follow-ups,
 * the analysis rules — which is the shape of our plumbing, not the shape of a
 * morning. It made the agent do the regrouping in their head every day: read
 * four lists, spot the rows that are the same customer, work out which ones
 * they can act on now.
 *
 * Now there is one task list, grouped into six piles ordered by whose time is
 * being burned: someone who rang and got no answer, a quote that has not gone
 * out, a promise made on a call, a Desk ticket waiting on us, a sale that lost
 * momentum, and — last, because there is nothing to do about it today —
 * everything parked on somebody else.
 *
 * **The two columns split by whether you act today.** Left is the queue; right
 * is the pile you review. Mixing them makes both harder to scan, and the left
 * column is the one an agent should be able to work top to bottom without
 * deciding anything.
 *
 * The masthead sits above both: four counts and the day's one sentence, read
 * together before any scrolling.
 */

/** Worked top to bottom, this morning. */
const COLUNA_FAZER: readonly CategoriaTarefa[] = [
  "devolver_chamada",
  "enviar_simulacao",
  "cumprir_compromisso",
];

/** Reviewed, not worked. Nothing here is a promise with a clock on it. */
const COLUNA_REVER: readonly CategoriaTarefa[] = [
  "espera_alfa",
  "retomar_conversa",
  "espera_cliente",
];

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
  const grupos = agruparTarefas(painel?.tarefas ?? []);
  const porCategoria = new Map(grupos.map((g) => [g.categoria, g.tarefas]));
  const conta = (c: CategoriaTarefa) => porCategoria.get(c)?.length ?? 0;

  const bloco = painel?.coaching;
  const coaching = bloco && coachingDisponivel(bloco) ? bloco : null;
  const semCoaching = bloco && !coachingDisponivel(bloco) ? bloco : null;
  const leitura = coaching?.paragraphOverview ? coaching : null;

  // A task list cannot say "we could not read your Desk" — a block that failed
  // simply contributes no rows, which on screen is indistinguishable from
  // having none. So the failures are named once, above everything, rather than
  // silently shrinking the list.
  const falhas = painel ? blocosEmFalha(painel) : [];
  const agora = new Date();

  if (aCarregar || !painel) return <Esqueleto />;

  return (
    <div className="space-y-4">
      <div
        className={
          leitura
            ? "grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-stretch"
            : ""
        }
      >
        <TiraDeIndicadores largo={!leitura}>
          {/* Only what means somebody is waiting on *us* gets a colour, and
              only the call — where the customer is already unanswered — gets
              red. Four red numbers is four numbers in no colour at all. */}
          <Kpi
            valor={conta("devolver_chamada")}
            rotulo="Por devolver"
            tom={conta("devolver_chamada") > 0 ? "alerta" : "normal"}
          />
          <Kpi
            valor={conta("enviar_simulacao")}
            rotulo="Simulações"
            tom={conta("enviar_simulacao") > 0 ? "aviso" : "normal"}
          />
          <Kpi valor={conta("cumprir_compromisso")} rotulo="Compromissos" />
          <Kpi valor={conta("espera_alfa")} rotulo="À espera da Alfa" />
        </TiraDeIndicadores>

        {leitura && <FaixaDoDia c={leitura} />}
      </div>

      {falhas.length > 0 && (
        <div className="space-y-1.5">
          {falhas.map((m) => (
            <Indisponivel key={m} motivo={m} />
          ))}
        </div>
      )}

      {grupos.length === 0 && falhas.length === 0 ? (
        <SemTarefas />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0 space-y-3">
            <Coluna
              titulo="Para hoje"
              categorias={COLUNA_FAZER}
              porCategoria={porCategoria}
              agora={agora}
              somenteLeitura={somenteLeitura}
            />
          </div>
          <div className="min-w-0 space-y-3">
            <Coluna
              titulo="Para rever"
              categorias={COLUNA_REVER}
              porCategoria={porCategoria}
              agora={agora}
              somenteLeitura={somenteLeitura}
            />
          </div>
        </div>
      )}

      {coaching ? (
        <BlocoCoaching c={coaching} />
      ) : semCoaching ? (
        <section className="space-y-2">
          <h2 className="t-micro px-0.5 text-stone-500">Leitura do dia</h2>
          <Indisponivel motivo={semCoaching.motivo} />
        </section>
      ) : null}

      <Agendamentos motivo={painel.agendamentos.motivo} />

      <p className="t-micro px-0.5 font-normal text-stone-400">
        Atualizado às {hora(painel.atualizadoEm)}
      </p>
    </div>
  );
}

/**
 * One column of task groups, under a heading that says what the column is for.
 *
 * The heading matters more than it looks: without it "À espera da Alfa" and
 * "Devolver chamadas" are two lists of similar-looking cards, and the fact
 * that one is this morning's work and the other is a review pile is left for
 * the agent to infer from the wording of six sub-headings.
 */
function Coluna({
  titulo,
  categorias,
  porCategoria,
  agora,
  somenteLeitura,
}: {
  titulo: string;
  categorias: readonly CategoriaTarefa[];
  porCategoria: Map<CategoriaTarefa, Tarefa[]>;
  agora: Date;
  somenteLeitura?: boolean;
}) {
  const presentes = categorias.filter((c) => (porCategoria.get(c)?.length ?? 0) > 0);
  if (presentes.length === 0) return null;

  return (
    <>
      <h2 className="t-micro px-0.5 text-stone-400">{titulo}</h2>
      {presentes.map((c) => (
        <GrupoDeTarefas
          key={c}
          categoria={c}
          tarefas={porCategoria.get(c)!}
          agora={agora}
          somenteLeitura={somenteLeitura}
        />
      ))}
    </>
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
      <div className="h-24 animate-pulse rounded-xl bg-stone-200/70" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl bg-stone-200/70" />
        <div className="h-48 animate-pulse rounded-xl bg-stone-200/70" />
      </div>
    </div>
  );
}
