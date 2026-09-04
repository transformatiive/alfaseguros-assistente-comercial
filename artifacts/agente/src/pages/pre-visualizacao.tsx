import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Bloco, Indisponivel } from "@/components/Bloco";
import { hora } from "@/lib/formatos";
import { BlocoDevolucoes, BlocoFollowUps, BlocoTickets, Agendamentos } from "@/pages/blocos";
import { VistaDaEquipa } from "@/pages/equipa";
import type { AgentePainel, Devolucao, FollowUp, TicketEmRisco } from "@/lib/tipos";

/**
 * The panel, for anyone, with no token — a review surface, not a product.
 *
 * The real panel opens only with a 15-minute token minted by a Zoho widget that
 * is not installed yet. Judging a layout takes longer than fifteen minutes, and
 * re-minting mid-sentence is administration, not review.
 *
 * It renders the SAME block components as the real panel. A preview built from
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
    throw new Error(
      "A pré-visualização está desligada no servidor (PAINEL_PREVIEW_ENABLED).",
    );
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
        <b>Pré-visualização.</b> Sem autenticação, só leitura, com dados reais de
        clientes. Serve para validar formato e conteúdo — deve ser desligada
        assim que a extensão do Desk funcionar.
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <select
          className="rounded-md border bg-background px-2 py-1 text-xs"
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
          className="rounded-md border bg-background px-2 py-1 text-xs"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        {equipaQ.error && (
          <span className="text-[11px] text-destructive">
            {(equipaQ.error as Error).message}
          </span>
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
    <div className="mx-auto max-w-xl space-y-5 p-3 pb-10">
      <header className="px-1">
        <h1 className="font-serif text-xl leading-tight">O meu dia</h1>
        <p className="text-xs text-muted-foreground">
          {painel ? painel.colaborador.nome : " "}
        </p>
        <p className="mt-0.5 text-xs font-medium">A mostrar {data}.</p>
      </header>

      <Bloco<Devolucao>
        titulo="Chamadas por devolver"
        dados={painel?.devolucoes}
        aCarregar={isLoading}
        vazio="Nenhuma chamada por devolver neste dia."
      >
        {(itens) => <BlocoDevolucoes itens={itens} somenteLeitura />}
      </Bloco>

      <Bloco<TicketEmRisco>
        titulo="Pedidos há mais de 24 h"
        dados={painel?.ticketsEmRisco}
        aCarregar={isLoading}
        vazio="Nenhum pedido passou das 24 horas."
      >
        {(itens) => <BlocoTickets itens={itens} />}
      </Bloco>

      <Bloco<FollowUp>
        titulo="Seguimentos"
        dados={painel?.followUps}
        aCarregar={isLoading}
        vazio="Nenhum seguimento por fazer."
      >
        {(itens) => <BlocoFollowUps itens={itens} />}
      </Bloco>

      <Agendamentos motivo={painel?.agendamentos.motivo} />

      {painel && (
        <Card className="p-3 text-[11px] text-muted-foreground">
          Atualizado às {hora(painel.atualizadoEm)}.
        </Card>
      )}
    </div>
  );
}
