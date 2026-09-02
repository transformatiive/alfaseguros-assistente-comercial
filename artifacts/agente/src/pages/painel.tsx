import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bloco, Indisponivel } from "@/components/Bloco";
import { enviar, obter } from "@/lib/api";
import { hora, idade, porqueMe, telefone } from "@/lib/formatos";
import type { AgentePainel, Devolucao, FollowUp, TicketEmRisco } from "@/lib/tipos";

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
 */
export function PainelDoAgente() {
  const { data, isLoading, error } = useQuery<AgentePainel>({
    queryKey: ["painel"],
    queryFn: () => obter<AgentePainel>("/api/agente/painel"),
    // Twice-daily server refresh; polling harder would cost requests and change
    // nothing. A stale minute here is invisible to the agent.
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar o painel. Se persistir, avisa o Nuno." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 p-3 pb-10">
      <Cabecalho painel={data} />

      <Bloco<Devolucao>
        titulo="Chamadas por devolver"
        dados={data?.devolucoes}
        aCarregar={isLoading}
        vazio="Nenhuma chamada por devolver hoje."
      >
        {(itens) => itens.map((d) => <LinhaDevolucao key={d.ids.join("-")} d={d} />)}
      </Bloco>

      <Bloco<TicketEmRisco>
        titulo="Pedidos há mais de 24 h"
        dados={data?.ticketsEmRisco}
        aCarregar={isLoading}
        vazio="Nenhum pedido teu passou das 24 horas."
      >
        {(itens) => itens.map((t) => <LinhaTicket key={t.id} t={t} />)}
      </Bloco>

      <Bloco<FollowUp>
        titulo="Seguimentos"
        dados={data?.followUps}
        aCarregar={isLoading}
        vazio="Nenhum seguimento por fazer."
      >
        {(itens) => itens.map((f) => <LinhaFollowUp key={f.id} f={f} />)}
      </Bloco>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">Agendamentos</h2>
        {/* Deliberately a different shape from the other blocks' empty state:
            "we cannot see this yet" must never be mistaken for "you have none". */}
        <Card className="border-dashed bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {data?.agendamentos.motivo ??
              "Os agendamentos ainda não estão disponíveis — vivem no CRM, que ainda não está ligado a este painel."}
          </p>
        </Card>
      </section>

      {data && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Atualizado às {hora(data.atualizadoEm)}.
        </p>
      )}
    </div>
  );
}

function Cabecalho({ painel }: { painel: AgentePainel | undefined }) {
  return (
    <header className="px-1">
      <h1 className="font-serif text-xl leading-tight">O meu dia</h1>
      <p className="text-xs text-muted-foreground">
        {painel ? painel.colaborador.nome : " "}
      </p>
    </header>
  );
}

function LinhaDevolucao({ d }: { d: Devolucao }) {
  const qc = useQueryClient();
  const concluir = useMutation({
    mutationFn: (estado: "devolvida" | "dispensada") =>
      // Any id in the group closes the whole group server-side — the same rule
      // the auto-resolution applies. Sending the first is enough.
      enviar(`/api/agente/devolucoes/${d.ids[0]}/concluir`, { estado }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["painel"] }),
  });

  const razao = porqueMe(d.atribuicaoOrigem);

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium tabular-nums">{telefone(d.numeroCliente)}</p>
          <p className="text-xs text-muted-foreground">
            {hora(d.primeiraChamada)}
            {d.tentativas > 1 && (
              <> · até às {hora(d.ultimaChamada)}</>
            )}
          </p>
        </div>
        {d.tentativas > 1 && (
          <Badge variant="destructive" className="shrink-0">
            {d.tentativas} tentativas
          </Badge>
        )}
      </div>

      {d.contexto && (
        <p className="mt-2 font-serif text-xs leading-relaxed text-foreground/80">{d.contexto}</p>
      )}

      {razao && <p className="mt-1.5 text-[11px] text-muted-foreground">{razao}</p>}

      <div className="mt-2.5 flex gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={concluir.isPending}
          onClick={() => concluir.mutate("devolvida")}
        >
          Devolvida
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={concluir.isPending}
          onClick={() => concluir.mutate("dispensada")}
        >
          Dispensar
        </Button>
      </div>

      {concluir.isError && (
        <p className="mt-1.5 text-[11px] text-destructive">
          Não foi possível fechar esta chamada. Tenta outra vez.
        </p>
      )}
    </Card>
  );
}

function LinhaTicket({ t }: { t: TicketEmRisco }) {
  return (
    <Card className="p-3">
      <a href={t.deskUrl} target="_blank" rel="noreferrer" className="block hover:underline">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-medium">
            {t.subject ?? "Pedido sem assunto"}
          </p>
          <Badge variant={t.idadeHoras >= 72 ? "destructive" : "secondary"} className="shrink-0">
            {idade(t.idadeHoras)}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t.ticketNumber ? `#${t.ticketNumber}` : t.id}
          {t.status && <> · {t.status}</>}
        </p>
      </a>
    </Card>
  );
}

function LinhaFollowUp({ f }: { f: FollowUp }) {
  return (
    <Card className="p-3">
      <p className="font-serif text-xs leading-relaxed">{f.follow_up_descricao}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {f.contact_phone ? telefone(f.contact_phone) : "sem número"}
        {f.product && <> · {f.product}</>}
      </p>
    </Card>
  );
}
