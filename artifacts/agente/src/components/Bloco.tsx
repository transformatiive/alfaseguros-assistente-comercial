import type { ReactNode } from "react";
import { Cabecalho } from "@/components/editorial";
import { estaDisponivel, type Bloco as BlocoDados } from "@/lib/tipos";

/**
 * The shell every block on the panel wears.
 *
 * Its whole job is to keep three states visibly different, because collapsing
 * them is how a panel starts lying:
 *
 *   **vazio**        — we looked, there is nothing. Good news, and it should
 *                      read as good news.
 *   **indisponível** — we could not look. Says why, in Portuguese, because an
 *                      agent who cannot see their tickets needs to know whether
 *                      to wait or to call someone.
 *   **a carregar**   — we are still looking.
 *
 * An empty list and a failed fetch both render as "no rows" if nobody stops
 * them, and the agent reads both as "nothing to do". One of those is a lie.
 */
export function Bloco<T>({
  titulo,
  cor,
  dados,
  aCarregar,
  vazio,
  children,
  acessorio,
}: {
  titulo: string;
  /** Section colour, per the prototype's semantic palette. */
  cor?: string;
  dados: BlocoDados<T> | undefined;
  aCarregar: boolean;
  /** What to say when the block is genuinely empty. */
  vazio: string;
  children: (itens: T[]) => ReactNode;
  acessorio?: ReactNode;
}) {
  const contagem = dados && estaDisponivel(dados) ? dados.length : null;

  return (
    <section className="space-y-1.5">
      <Cabecalho titulo={titulo} cor={cor} contagem={contagem} acessorio={acessorio} />

      {aCarregar || !dados ? (
        <div className="space-y-1.5">
          <div className="h-14 animate-pulse rounded-lg bg-stone-200/70" />
          <div className="h-14 animate-pulse rounded-lg bg-stone-200/70" />
        </div>
      ) : !estaDisponivel(dados) ? (
        <Indisponivel motivo={dados.motivo} />
      ) : dados.length === 0 ? (
        <p className="px-0.5 py-2 text-xs text-stone-400">{vazio}</p>
      ) : (
        children(dados)
      )}
    </section>
  );
}

/**
 * A block we could not build. Deliberately styled as a *notice*, not as an
 * error: most reasons are ordinary ("you have no Desk account yet"), and
 * painting them red teaches agents to ignore red.
 */
export function Indisponivel({ motivo }: { motivo: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-3 text-[11px] leading-relaxed text-stone-500">
      {motivo}
    </div>
  );
}
