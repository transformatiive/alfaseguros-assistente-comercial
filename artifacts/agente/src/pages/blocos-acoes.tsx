import { AlertTriangle, Flame, PhoneOff, ShieldAlert, Sparkles, Star, TrendingDown } from "lucide-react";
import { Cabecalho } from "@/components/editorial";
import { cn } from "@/lib/utils";
import { telefone } from "@/lib/formatos";
import type { Acao, Coaching, TipoAcao } from "@/lib/tipos";

/**
 * "Ações do Dia" and the coaching, for one agent.
 *
 * Both come from the daily analysis. The two rules worth understanding are the
 * ones that fire on an **absence**: `cotacao_sem_seguimento` and
 * `lead_quente_sem_fecho`. A quote that ended with no next step is invisible in
 * every other view precisely because nothing was recorded — which is exactly
 * why it earns a row of its own.
 *
 * Each row carries the call's own sentence. That is the point of putting the
 * summary here rather than behind a click: "Cotação sem seguimento marcado" is
 * a label; the same row plus *"Cliente pediu simulação de multirriscos para uma
 * casa em Cascais"* is a thing the agent can act on without opening anything.
 */

const ASPETO: Record<TipoAcao, { rotulo: string; icone: typeof Flame; cor: string }> = {
  follow_up_pendente: { rotulo: "Prometido", icone: AlertTriangle, cor: "text-red-700" },
  lead_quente_sem_fecho: { rotulo: "Por fechar", icone: Flame, cor: "text-red-700" },
  cotacao_sem_seguimento: { rotulo: "Sem seguimento", icone: PhoneOff, cor: "text-amber-700" },
  risco_perda_lead: { rotulo: "Em risco", icone: TrendingDown, cor: "text-amber-700" },
  desvio_procedimento: { rotulo: "Desvio", icone: ShieldAlert, cor: "text-amber-700" },
  qualidade_critica: { rotulo: "Qualidade", icone: Star, cor: "text-amber-700" },
  oportunidade_cross_sell: { rotulo: "Oportunidade", icone: Sparkles, cor: "text-blue-700" },
};

export function BlocoAcoes({ itens }: { itens: Acao[] }) {
  return (
    <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
      {itens.map((a) => (
        <LinhaAcao key={a.id} a={a} />
      ))}
    </div>
  );
}

function LinhaAcao({ a }: { a: Acao }) {
  const aspeto = ASPETO[a.tipo];
  const Icone = aspeto.icone;
  const urgente = a.prioridade === "alta";

  return (
    <div className={cn("p-3", urgente && "border-l-[3px] border-l-red-600")}>
      <div className="flex items-start gap-2">
        <Icone className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", aspeto.cor)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("t-micro", aspeto.cor)}>{aspeto.rotulo}</span>
            <span className="t-body text-stone-900">{a.titulo}</span>
          </div>

          {/* The call, in one sentence. Without it the row is a label. */}
          {a.descricao && (
            <p className="t-narrativa mt-1 text-stone-600">{a.descricao}</p>
          )}

          <p className="t-micro mt-1.5 font-normal normal-case tracking-normal text-stone-400">
            {a.contactName ?? telefone(a.customerPhone)}
            {a.contactName && <> · {telefone(a.customerPhone)}</>}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The coaching the daily analysis wrote for this agent.
 *
 * Shown as the prototype shows it: the overview in the dark banner, then
 * strengths and blind spots side by side, then the recommendations. Never as a
 * wall of bullets — the tone rules in the prompt were written so this reads as
 * an ally, and a wall of bullets reads as an audit.
 */
export function BlocoCoaching({ c }: { c: Coaching }) {
  const nada =
    !c.paragraphOverview &&
    c.strengths.length === 0 &&
    c.blindSpots.length === 0 &&
    c.coachingRecommendations.length === 0;
  if (nada) return null;

  return (
    <section className="space-y-2">
      <Cabecalho titulo="Leitura do dia" cor="text-stone-500" />

      {c.paragraphOverview && (
        <div className="rounded-lg bg-stone-900 p-4 text-stone-50">
          <p className="t-narrativa italic">{c.paragraphOverview}</p>
        </div>
      )}

      {c.closingRateObservations && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="t-body text-blue-900">{c.closingRateObservations}</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Lista
          titulo="Pontos fortes"
          itens={c.strengths}
          cor="text-emerald-700"
          ponto="bg-emerald-400"
        />
        <Lista
          titulo="A desenvolver"
          itens={c.blindSpots}
          cor="text-amber-700"
          ponto="bg-amber-400"
        />
      </div>

      <Lista
        titulo="Para a próxima semana"
        itens={c.coachingRecommendations}
        cor="text-blue-700"
        ponto="bg-blue-400"
      />
    </section>
  );
}

function Lista({
  titulo,
  itens,
  cor,
  ponto,
}: {
  titulo: string;
  itens: string[];
  cor: string;
  ponto: string;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <p className={cn("t-micro", cor)}>{titulo}</p>
      <ul className="mt-2 space-y-2">
        {itens.map((t, i) => (
          <li key={i} className="t-body flex items-start gap-2 text-stone-700">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ponto)} aria-hidden />
            <RicoEmNegrito texto={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The model is instructed to mark two or three phrases per item with markdown
 * bold. Rendering it literally would put asterisks on screen; dropping it would
 * throw away the one piece of emphasis the writer chose deliberately.
 */
function RicoEmNegrito({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-stone-900">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
