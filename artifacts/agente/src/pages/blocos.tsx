import { Cabecalho } from "@/components/editorial";

/* ── Agendamentos ──────────────────────────────────────────────────────── */

/**
 * Always unavailable, and deliberately shaped unlike every other empty state.
 * "We cannot see this yet" must never read as "you have none".
 */
export function Agendamentos({ motivo }: { motivo?: string }) {
  return (
    <section className="space-y-1.5">
      <Cabecalho titulo="Agendamentos" />
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-3">
        <p className="t-meta text-stone-500">
          {motivo ??
            "Os agendamentos ainda não estão disponíveis — vivem no CRM, que ainda não está ligado a este painel."}
        </p>
      </div>
    </section>
  );
}
