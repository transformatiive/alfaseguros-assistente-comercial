import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The prototype's visual signature, as components rather than as discipline.
 *
 * HANDOVER.md §3 is explicit about this and asks for it not to be simplified:
 * warm stone neutrals, Georgia for anything that carries a number or a
 * narrative, 10px uppercase letter-spaced labels. It is an editorial dashboard,
 * not an admin panel, and the difference is almost entirely in these three
 * decisions.
 *
 * Georgia is set inline rather than by class because it is load-bearing: a
 * Tailwind purge or a token rename would silently drop it, and the panel would
 * quietly become the generic thing it is trying not to be.
 */

const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" } as const;

/** A single number with its label. The stat strip is built from these. */
export function Kpi({
  valor,
  rotulo,
  alerta,
}: {
  valor: string | number;
  rotulo: string;
  /** Turns the value red. For counts that mean somebody is waiting. */
  alerta?: boolean;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2.5">
      <div
        className={cn("text-2xl leading-none", alerta ? "text-red-600" : "text-stone-900")}
        style={SERIF}
      >
        {valor}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-wide text-stone-400">{rotulo}</div>
    </div>
  );
}

export function TiraDeIndicadores({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

/**
 * A section heading. Coloured by meaning, not by decoration: the colour is the
 * fastest thing the eye reads, so it should say how urgent the section is
 * before any word does.
 */
export function Cabecalho({
  titulo,
  cor = "text-stone-500",
  contagem,
  acessorio,
}: {
  titulo: string;
  cor?: string;
  contagem?: number | null;
  acessorio?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-0.5">
      <h2 className={cn("text-xs font-semibold uppercase tracking-wide", cor)}>
        {titulo}
        {contagem != null && contagem > 0 && (
          <span className="ml-1.5 tabular-nums text-stone-400">{contagem}</span>
        )}
      </h2>
      {acessorio}
    </div>
  );
}

/** The dark banner the prototype uses for the one sentence that matters most. */
export function Faixa({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-stone-900 p-4 text-stone-50">
      <p className="text-sm italic leading-relaxed" style={SERIF}>
        {children}
      </p>
    </div>
  );
}

/** Narrative text — a call's context, a follow-up's description. */
export function Narrativa({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-stone-700", className)} style={SERIF}>
      {children}
    </p>
  );
}

export { SERIF };
