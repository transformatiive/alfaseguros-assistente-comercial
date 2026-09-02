import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  dados,
  aCarregar,
  vazio,
  children,
  acessorio,
}: {
  titulo: string;
  dados: BlocoDados<T> | undefined;
  aCarregar: boolean;
  /** What to say when the block is genuinely empty. */
  vazio: string;
  children: (itens: T[]) => ReactNode;
  /** Rendered on the title row — a count, a link. */
  acessorio?: ReactNode;
}) {
  const contagem = dados && estaDisponivel(dados) ? dados.length : null;

  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold tracking-tight">
          {titulo}
          {contagem !== null && contagem > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              {contagem}
            </span>
          )}
        </h2>
        {acessorio}
      </header>

      {aCarregar || !dados ? (
        <div className="space-y-1.5">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !estaDisponivel(dados) ? (
        <Indisponivel motivo={dados.motivo} />
      ) : dados.length === 0 ? (
        <Vazio texto={vazio} />
      ) : (
        <div className="space-y-1.5">{children(dados)}</div>
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
    <Card className="border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
      {motivo}
    </Card>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="px-1 py-3 text-xs text-muted-foreground">{texto}</p>
  );
}
