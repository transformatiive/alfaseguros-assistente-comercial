import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Indisponivel } from "@/components/Bloco";
import { Seletor, type Opcao } from "@/components/seletor";
import { obter } from "@/lib/api";
import { comDia, diaPedido } from "@/lib/dia";
import { CorpoDoPainel } from "@/pages/painel-corpo";
import type { AgentePainel } from "@/lib/tipos";

/**
 * The agent panel: what must I do today, in four blocks.
 *
 * Ordered by how much the customer is waiting, not by how interesting the data
 * is. Missed calls first — somebody rang and nobody answered, and that is the
 * only block where the customer has already noticed.
 *
 * Laid out narrow by default. It is rendered inside the Zoho Desk left panel,
 * which is roughly a phone's width; designing wide and letting it squash is how
 * you get a panel nobody uses.
 *
 * ## A supervisor sees the same screen, for anyone
 *
 * Above the body, and only for a supervisor, there is a picker. Choosing
 * somebody else swaps the panel for *their* panel — the same rows, the same
 * coaching, built by the same code on the server. Not a supervisor-shaped
 * version of it: two screens that can disagree are worse than one, because
 * then a conversation between a supervisor and an agent is about two different
 * screens.
 *
 * An agent never sees the picker, and would get a 403 if they asked for it
 * anyway. The hiding is the courtesy; the 403 is the control.
 */

interface Colaborador {
  id: number;
  nome: string;
  papel: string;
}

const EU = "eu";

export function PainelDoAgente() {
  // Whose panel is on screen. `EU` rather than an id, because "me" is known to
  // the server and not to this component.
  const [aVer, setAVer] = useState<string>(EU);

  // My own panel. Same key and URL as App's query, so the two share one fetch
  // and cannot disagree about my role.
  const meu = useQuery<AgentePainel>({
    queryKey: ["painel", diaPedido()],
    queryFn: () => obter<AgentePainel>(comDia("/api/agente/painel")),
    // Twice-daily server refresh; polling harder would cost requests and change
    // nothing. A stale minute here is invisible to the agent.
    staleTime: 60_000,
  });

  const souSupervisor = meu.data?.colaborador.papel === "supervisor";

  /*
   * The list of people to choose from.
   *
   * Asked for only by a supervisor, because for anybody else it is a 403 and
   * an error in the console every time the panel loads. `retry: false` for the
   * same reason: a forbidden list does not become allowed on the third try.
   */
  const equipa = useQuery<{ colaboradores: Colaborador[] }>({
    queryKey: ["supervisor-colaboradores"],
    queryFn: () => obter("/api/supervisor/colaboradores"),
    enabled: souSupervisor,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const outroId = aVer === EU ? null : Number(aVer);

  const outro = useQuery<AgentePainel>({
    queryKey: ["painel-de", outroId, diaPedido()],
    queryFn: () => obter<AgentePainel>(comDia(`/api/supervisor/painel/${outroId}`)),
    enabled: outroId !== null,
    staleTime: 60_000,
  });

  // Whichever is on screen. Note the loading state follows the *chosen* query:
  // while somebody else's panel loads, mine is already cached and showing it
  // would flash the wrong person's day on screen.
  const activo = outroId === null ? meu : outro;

  if (activo.error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar o painel. Se persistir, avisa o Nuno." />
      </div>
    );
  }

  const opcoes: Opcao[] = [
    { valor: EU, rotulo: "O meu painel" },
    ...(equipa.data?.colaboradores ?? []).map((c) => ({
      valor: String(c.id),
      rotulo: c.nome,
      nota: c.papel === "supervisor" ? "supervisor" : undefined,
    })),
  ];

  return (
    // The heading lives in the panel body's masthead, with the name, the date
    // and the counts together. Two headings, one here and one there, put the
    // agent's name on screen twice and the day's numbers under a title that
    // said nothing.
    <div className="mx-auto max-w-6xl p-3 pb-10 sm:p-4">
      {souSupervisor && equipa.data && (
        <BarraDeEscolha
          opcoes={opcoes}
          valor={aVer}
          aoMudar={setAVer}
          aVerOutro={outroId !== null}
          aoVoltar={() => setAVer(EU)}
        />
      )}
      <CorpoDoPainel painel={activo.data} aCarregar={activo.isLoading} />
    </div>
  );
}

/**
 * The picker, plus a line saying plainly whose day this is.
 *
 * The line is not decoration. The body greets the person by name — "Bom dia,
 * Tiago" — and a supervisor reading that without knowing why would reasonably
 * wonder what happened to their own panel. Saying it outright, with the way
 * back next to it, costs one line and removes the doubt.
 */
function BarraDeEscolha({
  opcoes,
  valor,
  aoMudar,
  aVerOutro,
  aoVoltar,
}: {
  opcoes: readonly Opcao[];
  valor: string;
  aoMudar: (v: string) => void;
  aVerOutro: boolean;
  aoVoltar: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="t-micro text-stone-400">A ver</span>
      <Seletor
        opcoes={opcoes}
        valor={valor}
        aoMudar={aoMudar}
        etiqueta="Escolher de quem é o painel"
        className="w-56"
      />
      {aVerOutro && (
        <button
          type="button"
          onClick={aoVoltar}
          className="t-micro text-stone-400 underline underline-offset-2 transition-colors hover:text-stone-700"
        >
          voltar ao meu
        </button>
      )}
    </div>
  );
}
