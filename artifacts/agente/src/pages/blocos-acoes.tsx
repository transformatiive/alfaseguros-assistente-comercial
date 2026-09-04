import { Cabecalho, Faixa } from "@/components/editorial";
import { cn } from "@/lib/utils";
import type { Coaching } from "@/lib/tipos";

/**
 * The one sentence the model wrote about this agent's day.
 *
 * Split out of the coaching block on purpose: it belongs at the *top* of the
 * page, beside the numbers, not four hundred pixels below a list of sixty
 * tickets. It is the only thing on the panel that says what the day was
 * *like*, and a summary read after the detail is not a summary.
 */
export function FaixaDoDia({ c }: { c: Coaching }) {
  if (!c.paragraphOverview) return null;
  return <Faixa>{c.paragraphOverview}</Faixa>;
}

/**
 * The rest of the coaching: what went well, what did not, what to try next.
 *
 * Shown as the prototype shows it — strengths and blind spots side by side,
 * then the recommendations. Never as a wall of bullets: the tone rules in the
 * prompt were written so this reads as an ally, and a wall of bullets reads as
 * an audit.
 */
export function BlocoCoaching({ c }: { c: Coaching }) {
  const nada =
    !c.closingRateObservations &&
    c.strengths.length === 0 &&
    c.blindSpots.length === 0 &&
    c.coachingRecommendations.length === 0;
  if (nada) return null;

  return (
    <section className="space-y-2">
      <Cabecalho titulo="Leitura do dia" cor="text-stone-500" />

      {c.closingRateObservations && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="t-body text-blue-900">{c.closingRateObservations}</p>
        </div>
      )}

      {/* Three abreast, because this block now has the full page width. In one
          narrow column the same three lists were a thirteen-hundred-pixel tail
          that nobody would reach; side by side they read as what they are —
          what went well, what did not, what to try next. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
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
        <Lista
          titulo="Para a próxima semana"
          itens={c.coachingRecommendations}
          cor="text-blue-700"
          ponto="bg-blue-400"
        />
      </div>
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
