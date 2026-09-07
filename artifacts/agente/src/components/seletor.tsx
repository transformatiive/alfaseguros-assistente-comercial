import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A dropdown that looks like the rest of the panel.
 *
 * A native `<select>` renders with the operating system's own list — grey on
 * Windows, blue on macOS, a full-screen sheet on Android — which is exactly
 * the one control on the page that cannot be made to match anything around it.
 * On a review surface whose whole job is judging layout, a widget that looks
 * borrowed from another program is the thing the eye keeps landing on.
 *
 * Deliberately small in scope: single choice, no search, no groups. It exists
 * for the preview's agent picker and is meant to be deleted with it — building
 * a general-purpose combobox for a control that ships disabled would be paying
 * for a thing nobody asked for.
 *
 * Keyboard and screen readers are not skipped, though: `role="listbox"`, Enter
 * and Space to open, Escape to close, arrows to move, and focus returned to
 * the button on close. A temporary control is still a control.
 */

export interface Opcao {
  valor: string;
  rotulo: string;
  /** Second line, smaller. For the thing that distinguishes two similar rows. */
  nota?: string;
}

export function Seletor({
  opcoes,
  valor,
  aoMudar,
  etiqueta,
  className,
}: {
  opcoes: readonly Opcao[];
  valor: string;
  aoMudar: (valor: string) => void;
  /** Announced to screen readers; never drawn, so the bar stays compact. */
  etiqueta: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [focado, setFocado] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  const escolhida = opcoes.find((o) => o.valor === valor) ?? opcoes[0];

  // Clicking anywhere else closes it. Without this the list stays open behind
  // whatever the person went on to click, which on a dense page is a menu
  // floating over the content they are trying to read.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  useEffect(() => {
    if (aberto) setFocado(Math.max(0, opcoes.findIndex((o) => o.valor === valor)));
  }, [aberto, opcoes, valor]);

  function escolher(v: string) {
    aoMudar(v);
    setAberto(false);
    botao.current?.focus();
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setAberto(false);
      botao.current?.focus();
      return;
    }
    if (!aberto && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setAberto(true);
      return;
    }
    if (!aberto) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocado((i) => Math.min(opcoes.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocado((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = opcoes[focado];
      if (o) escolher(o.valor);
    }
  }

  return (
    <div ref={raiz} className={cn("relative", className)} onKeyDown={teclas}>
      <button
        ref={botao}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={etiqueta}
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 t-body text-stone-800 transition-colors hover:border-stone-300"
      >
        <span className="truncate">{escolhida?.rotulo ?? "—"}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform",
            aberto && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {aberto && (
        <ul
          role="listbox"
          aria-label={etiqueta}
          className="absolute z-20 mt-1 max-h-72 w-full min-w-52 overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {opcoes.map((o, i) => {
            const activa = o.valor === valor;
            return (
              <li
                key={o.valor}
                role="option"
                aria-selected={activa}
                onMouseEnter={() => setFocado(i)}
                onClick={() => escolher(o.valor)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2.5 py-1.5",
                  i === focado && "bg-stone-100",
                )}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-stone-900",
                    activa ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate t-body text-stone-800">{o.rotulo}</span>
                  {o.nota && <span className="block truncate t-meta text-stone-400">{o.nota}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
