import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Indisponivel } from "@/components/Bloco";
import { diaPorExtenso } from "@/lib/formatos";
import { CorpoDoPainel } from "@/pages/painel-corpo";
import { VistaDaEquipa } from "@/pages/equipa";
import type { AgentePainel } from "@/lib/tipos";

/**
 * The panel, for anyone, with no token — a review surface, not a product.
 *
 * The real panel opens only with a 15-minute token minted by a Zoho widget that
 * is not installed yet. Judging a layout takes longer than fifteen minutes, and
 * re-minting mid-sentence is administration, not review.
 *
 * It renders the SAME body component as the real panel. A preview built from
 * its own markup would validate a screen nobody will ever see, which is worse
 * than no preview at all.
 *
 * The banner is deliberately loud. This page reads real customer numbers, and
 * the person looking at it should never be in doubt about which of the two
 * things they have open.
 */

interface Colaborador {
  id: number;
  nome: string;
  papel: string;
}

/** Its own fetch: this page has no token, so it must not use `obter`. */
async function ler<T>(caminho: string): Promise<T> {
  const res = await fetch(caminho);
  if (res.status === 404) {
    throw new Error("A pré-visualização está desligada no servidor (PAINEL_PREVIEW_ENABLED).");
  }
  if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`);
  return (await res.json()) as T;
}

function ontemLisboa(): string {
  const agora = new Date();
  agora.setUTCDate(agora.getUTCDate() - 1);
  return agora.toISOString().slice(0, 10);
}

export function PreVisualizacao() {
  // Defaults to yesterday, not today: today has no computed missed calls until
  // the scheduled refresh runs, and an empty screen reviews nothing.
  const [data, setData] = useState(ontemLisboa());
  const [quem, setQuem] = useState<number | "equipa" | null>(null);

  const equipaQ = useQuery<{ colaboradores: Colaborador[] }>({
    queryKey: ["pv-colaboradores"],
    queryFn: () => ler("/api/agente/pre-visualizacao/colaboradores"),
  });

  const colaboradores = equipaQ.data?.colaboradores ?? [];
  // First render: land on somebody rather than on a blank page.
  const escolhido = quem ?? (colaboradores.length > 0 ? colaboradores[0].id : null);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 t-meta text-amber-900">
        <b>Pré-visualização.</b> Sem autenticação, só leitura, com dados reais de
        clientes. Serve para validar formato e conteúdo — deve ser desligada
        assim que a extensão do Desk funcionar.
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
        <select
          className="rounded-md border border-stone-200 bg-white px-2 py-1 t-body text-stone-700"
          value={escolhido === null ? "" : String(escolhido)}
          onChange={(e) =>
            setQuem(e.target.value === "equipa" ? "equipa" : Number(e.target.value))
          }
        >
          {colaboradores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
              {c.papel === "supervisor" ? " (supervisor)" : ""}
            </option>
          ))}
          <option value="equipa">— Vista da equipa —</option>
        </select>

        <input
          type="date"
          className="rounded-md border border-stone-200 bg-white px-2 py-1 t-body text-stone-700"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        {equipaQ.error && (
          <span className="t-meta text-red-600">{(equipaQ.error as Error).message}</span>
        )}
      </div>

      {escolhido === "equipa" ? (
        <VistaDaEquipa
          origem={`/api/agente/pre-visualizacao/equipa?data=${data}`}
          chave={["pv-equipa", data]}
        />
      ) : escolhido === null ? (
        <div className="p-3">
          <Indisponivel motivo="Ainda não há colaboradores para mostrar." />
        </div>
      ) : (
        <PainelDeUm id={escolhido} data={data} />
      )}
    </div>
  );
}

function PainelDeUm({ id, data }: { id: number; data: string }) {
  const { data: painel, isLoading, error } = useQuery<AgentePainel>({
    queryKey: ["pv-painel", id, data],
    queryFn: () =>
      ler(`/api/agente/pre-visualizacao/painel?colaboradorId=${id}&data=${data}`),
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo={(error as Error).message} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-10 sm:p-4">
      <header className="px-0.5">
        <h1 className="t-display text-stone-900">
          O meu dia
        </h1>
        <p className="t-micro text-stone-400">
          {painel ? painel.colaborador.nome : " "} · {diaPorExtenso(data)}
        </p>
      </header>

      <CorpoDoPainel painel={painel} aCarregar={isLoading} somenteLeitura />
    </div>
  );
}
