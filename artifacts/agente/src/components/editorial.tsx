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

/**
 * How loud a number is allowed to be.
 *
 * Four boxes in four different reds is four boxes in no colour at all. Only a
 * count that means *somebody is waiting right now* earns red; a count that
 * means *there is work here* earns amber; everything else is just a number.
 */
export type Tom = "normal" | "aviso" | "alerta";

const COR_DO_TOM: Record<Tom, string> = {
  normal: "text-stone-900",
  aviso: "text-amber-600",
  alerta: "text-red-600",
};

/** A single number with its label. The stat band is built from these. */
export function Kpi({
  valor,
  rotulo,
  tom = "normal",
}: {
  valor: string | number;
  rotulo: string;
  tom?: Tom;
}) {
  return (
    <div className="bg-white px-4 py-3.5">
      <div className={cn("t-metric leading-none", COR_DO_TOM[tom])}>{valor}</div>
      <div className="mt-2 t-micro text-stone-400">{rotulo}</div>
    </div>
  );
}

/**
 * The four numbers as one object, not four floating boxes.
 *
 * `gap-px` over a stone background draws the hairlines: it gives a true
 * one-pixel rule between cells in both the 2-up and the 4-up arrangement,
 * which per-cell borders do not without a pile of `nth-child` rules.
 */
export function TiraDeIndicadores({
  children,
  /** Four across when the band has the page to itself; 2×2 beside the banner. */
  largo,
}: {
  children: ReactNode;
  largo?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200",
        largo && "sm:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
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
      <h2 className={cn("t-micro", cor)}>
        {titulo}
        {contagem != null && contagem > 0 && (
          <span className="ml-1.5 tabular-nums text-stone-400">{contagem}</span>
        )}
      </h2>
      {acessorio}
    </div>
  );
}

/**
 * The dark banner the prototype uses for the one sentence that matters most.
 *
 * `h-full` so that when it sits beside the stat band the two read as one
 * masthead rather than as two things that happen to be adjacent.
 */
export function Faixa({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-xl bg-stone-900 p-5 text-stone-50">
      <p className="t-narrativa italic">
        {children}
      </p>
    </div>
  );
}

/** Narrative text — a call's context, a follow-up's description. */
export function Narrativa({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("t-narrativa break-words text-stone-700", className)}>
      {children}
    </p>
  );
}

export { SERIF };
