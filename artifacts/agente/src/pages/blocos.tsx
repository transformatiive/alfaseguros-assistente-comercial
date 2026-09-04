import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { enviar } from "@/lib/api";
import { hora, idade, porqueMe, telefone } from "@/lib/formatos";
import { agruparPorEstado } from "@/lib/estados";
import { Cabecalho, Narrativa } from "@/components/editorial";
import { cn } from "@/lib/utils";
import type { Devolucao, FollowUp, TicketEmRisco } from "@/lib/tipos";

/**
 * The rows, shared by the real panel and the preview.
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

/* ── Chamadas por devolver ─────────────────────────────────────────────── */

export function BlocoDevolucoes({
  itens,
  somenteLeitura,
}: {
  itens: Devolucao[];
  somenteLeitura?: boolean;
}) {
  return (
    <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
      {itens.map((d) => (
        <LinhaDevolucao key={d.ids.join("-")} d={d} somenteLeitura={somenteLeitura} />
      ))}
    </div>
  );
}

function LinhaDevolucao({ d, somenteLeitura }: { d: Devolucao; somenteLeitura?: boolean }) {
  const qc = useQueryClient();
  const concluir = useMutation({
    mutationFn: (estado: "devolvida" | "dispensada") =>
      // Any id in the group closes the whole group server-side — the same rule
      // the auto-resolution applies. Sending the first is enough.
      enviar(`/api/agente/devolucoes/${d.ids[0]}/concluir`, { estado }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["painel"] }),
  });

  const razao = porqueMe(d.atribuicaoOrigem);
  const insistente = d.tentativas > 1;

  return (
    <div className={cn("p-3", insistente && "border-l-[3px] border-l-red-600")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium tabular-nums text-stone-900">{telefone(d.numeroCliente)}</p>
        <p className="shrink-0 t-body tabular-nums text-stone-400">
          {hora(d.primeiraChamada)}
          {insistente && <> – {hora(d.ultimaChamada)}</>}
        </p>
      </div>

      {insistente && (
        <p className="mt-0.5 t-micro text-red-700">
          {d.tentativas} tentativas
        </p>
      )}

      {d.contexto && <Narrativa className="mt-1.5">{d.contexto}</Narrativa>}
      {razao && <p className="mt-1 t-meta text-stone-400">{razao}</p>}

      {!somenteLeitura && (
        <>
          <div className="mt-2.5 flex gap-1.5">
            <button
              className="rounded-md bg-stone-900 px-3 py-1.5 t-body font-medium text-stone-50 disabled:opacity-50"
              disabled={concluir.isPending}
              onClick={() => concluir.mutate("devolvida")}
            >
              Devolvida
            </button>
            <button
              className="rounded-md border border-stone-200 px-3 py-1.5 t-body font-medium text-stone-600 disabled:opacity-50"
              disabled={concluir.isPending}
              onClick={() => concluir.mutate("dispensada")}
            >
              Dispensar
            </button>
          </div>
          {concluir.isError && (
            <p className="mt-1.5 t-meta text-red-600">
              Não foi possível fechar esta chamada. Tenta outra vez.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ── Pedidos do Desk, agrupados por estado ─────────────────────────────── */

export function BlocoTickets({ itens }: { itens: TicketEmRisco[] }) {
  const grupos = agruparPorEstado(itens);
  return (
    <div className="space-y-3">
      {grupos.map((g) => (
        <GrupoDeTickets key={g.estado} {...g} />
      ))}
    </div>
  );
}

/**
 * How many rows a group shows before it asks. Six is about a thumb's scroll on
 * the Desk panel: enough to see the shape of the group, few enough that the
 * next heading stays on screen.
 *
 * Without this the biggest group — 49 `Novo` on a real day — buries every other
 * heading below it, and grouping buys nothing: the agent is back to scrolling a
 * wall, only now the wall has a title.
 */
const VISIVEIS = 6;

function GrupoDeTickets({
  estado,
  tickets,
  agir,
  cor,
}: ReturnType<typeof agruparPorEstado>[number]) {
  // Groups the agent can act on open; groups parked on somebody else start
  // closed. The counts stay visible either way, so nothing is hidden — only
  // deferred.
  const [aberto, setAberto] = useState(agir);
  const [tudo, setTudo] = useState(false);

  const mostrados = tudo ? tickets : tickets.slice(0, VISIVEIS);
  const escondidos = tickets.length - mostrados.length;

  return (
    <div>
      <button
        className="flex w-full items-baseline gap-1.5 px-0.5 py-1 text-left"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-stone-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-stone-400" />
        )}
        <span className={cn("t-micro", cor)}>
          {estado}
        </span>
        <span className="tabular-nums t-meta text-stone-400">{tickets.length}</span>
      </button>

      {aberto && (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="divide-y divide-stone-200">
            {mostrados.map((t) => (
              <LinhaTicket key={t.id} t={t} />
            ))}
          </div>
          {escondidos > 0 && (
            <button
              className="w-full border-t border-stone-200 bg-stone-50 py-1.5 t-meta text-stone-500 hover:text-stone-900"
              onClick={() => setTudo(true)}
            >
              mostrar mais {escondidos}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaTicket({ t }: { t: TicketEmRisco }) {
  const velho = t.idadeHoras >= 72;
  return (
    <a
      href={t.deskUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex items-baseline justify-between gap-3 p-2.5 hover:bg-stone-50"
    >
      <div className="min-w-0">
        <p className="truncate t-body text-stone-900">
          {t.subject ?? "Pedido sem assunto"}
          <ExternalLink className="ml-1 inline h-3 w-3 -translate-y-px text-stone-300 group-hover:text-stone-500" />
        </p>
        <p className="mt-0.5 t-meta tabular-nums text-stone-400">
          {t.ticketNumber ? `#${t.ticketNumber}` : t.id}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 t-meta tabular-nums",
          velho ? "font-semibold text-red-600" : "text-stone-400",
        )}
      >
        {idade(t.idadeHoras)}
      </span>
    </a>
  );
}

/* ── Seguimentos ───────────────────────────────────────────────────────── */

export function BlocoFollowUps({ itens }: { itens: FollowUp[] }) {
  return (
    <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
      {itens.map((f) => (
        // Same row grammar as the actions block — icon, label, the promise in
        // the customer's own terms, then who it was to. Seven bare paragraphs
        // of Georgia read as an essay next to every other block on the panel,
        // and the eye had nothing to land on.
        <div key={f.id} className="flex items-start gap-2 p-3">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="t-micro text-blue-700">Prometido</span>
            <Narrativa className="mt-1">{f.follow_up_descricao}</Narrativa>
            <p className="mt-1 t-meta tabular-nums text-stone-400">
              {f.contact_phone ? telefone(f.contact_phone) : "sem número"}
              {f.product && <> · {f.product}</>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Agendamentos ──────────────────────────────────────────────────────── */

/**
 * Always unavailable, and deliberately shaped unlike every other empty state.
 * "We cannot see this yet" must never read as "you have none".
 */
export function Agendamentos({ motivo }: { motivo?: string }) {
  return (
    <section className="space-y-1.5">
      <Cabecalho titulo="Agendamentos" />
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100/60 p-3">
        <p className="t-meta text-stone-500">
          {motivo ??
            "Os agendamentos ainda não estão disponíveis — vivem no CRM, que ainda não está ligado a este painel."}
        </p>
      </div>
    </section>
  );
}
