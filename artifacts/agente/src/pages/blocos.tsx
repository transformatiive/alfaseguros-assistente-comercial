import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { enviar } from "@/lib/api";
import { hora, idade, porqueMe, telefone } from "@/lib/formatos";
import type { Devolucao, FollowUp, TicketEmRisco } from "@/lib/tipos";

/**
 * The rows themselves, shared by the real panel and the preview.
 *
 * Extracted for one reason: a preview that draws its own markup validates a
 * screen nobody will ever see. If these ever diverge, the review stops being
 * worth anything, and the only way to guarantee they do not is for there to be
 * one copy.
 *
 * `somenteLeitura` hides the actions. The preview has no token, so the write
 * endpoints would reject it anyway — but showing buttons that cannot work is a
 * worse answer than not showing them.
 */

export function BlocoDevolucoes({
  itens,
  somenteLeitura,
}: {
  itens: Devolucao[];
  somenteLeitura?: boolean;
}) {
  return (
    <>
      {itens.map((d) => (
        <LinhaDevolucao key={d.ids.join("-")} d={d} somenteLeitura={somenteLeitura} />
      ))}
    </>
  );
}

function LinhaDevolucao({
  d,
  somenteLeitura,
}: {
  d: Devolucao;
  somenteLeitura?: boolean;
}) {
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
            {d.tentativas > 1 && <> · até às {hora(d.ultimaChamada)}</>}
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

      {!somenteLeitura && (
        <>
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
        </>
      )}
    </Card>
  );
}

export function BlocoTickets({ itens }: { itens: TicketEmRisco[] }) {
  return (
    <>
      {itens.map((t) => (
        <Card key={t.id} className="p-3">
          <a href={t.deskUrl} target="_blank" rel="noreferrer" className="block hover:underline">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate font-medium">{t.subject ?? "Pedido sem assunto"}</p>
              <Badge
                variant={t.idadeHoras >= 72 ? "destructive" : "secondary"}
                className="shrink-0"
              >
                {idade(t.idadeHoras)}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.ticketNumber ? `#${t.ticketNumber}` : t.id}
              {t.status && <> · {t.status}</>}
            </p>
          </a>
        </Card>
      ))}
    </>
  );
}

export function BlocoFollowUps({ itens }: { itens: FollowUp[] }) {
  return (
    <>
      {itens.map((f) => (
        <Card key={f.id} className="p-3">
          <p className="font-serif text-xs leading-relaxed">{f.follow_up_descricao}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {f.contact_phone ? telefone(f.contact_phone) : "sem número"}
            {f.product && <> · {f.product}</>}
          </p>
        </Card>
      ))}
    </>
  );
}

/**
 * Scheduling: always unavailable, and deliberately shaped unlike every other
 * empty state. "We cannot see this yet" must never read as "you have none".
 */
export function Agendamentos({ motivo }: { motivo?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold tracking-tight">Agendamentos</h2>
      <Card className="border-dashed bg-muted/30 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {motivo ??
            "Os agendamentos ainda não estão disponíveis — vivem no CRM, que ainda não está ligado a este painel."}
        </p>
      </Card>
    </section>
  );
}
