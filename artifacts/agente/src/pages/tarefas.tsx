import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalculatorIcon,
  CircleCheck,
  Handshake,
  Hourglass,
  Inbox,
  PhoneIncoming,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { enviar } from "@/lib/api";
import { porqueMe, telefone } from "@/lib/formatos";
import type { CategoriaTarefa, Tarefa } from "@/lib/tipos";

/**
 * The task list — the whole panel, really.
 *
 * Grouped by **what the task asks of you**, not by where the row came from. An
 * agent's morning is not "calls, then Desk, then follow-ups"; it is "who is
 * waiting on me, and what do they need". Four separate lists forced them to do
 * that regrouping in their head, every day.
 *
 * Every row answers the same four questions in the same four places, so the
 * eye learns the shape once and stops re-reading it:
 *
 *     [icon]  WHAT TO DO                                    [waiting] [→]
 *             Name · phone · email
 *             Why, in the words of the call
 *             ────────────────────────────  by when
 */

interface Aspeto {
  titulo: string;
  /** One line under the heading: what this pile *is*, in the agent's terms. */
  legenda: string;
  icone: LucideIcon;
  /** Colour of the icon and count. Says how urgent before any word does. */
  cor: string;
  fundo: string;
  /** Rows shown before "mostrar mais". Bigger for the piles you work first. */
  visiveis: number;
}

/**
 * Icons chosen so the category is readable at a glance, without the label.
 *
 * Each one depicts the *act*, never the data source: a returned call is a
 * handset with an inbound arrow, a quote is a calculator, a promise is a
 * handshake. That is the difference between an icon and decoration — and it is
 * why the two "waiting" piles get an inbox and an hourglass, which say whose
 * move it is before the heading does.
 */
const ASPETO: Record<CategoriaTarefa, Aspeto> = {
  devolver_chamada: {
    titulo: "Devolver chamadas",
    legenda: "Ligaram e ninguém atendeu",
    icone: PhoneIncoming,
    cor: "text-red-700",
    fundo: "bg-red-50",
    visiveis: 6,
  },
  enviar_simulacao: {
    titulo: "Simulações por enviar",
    legenda: "Pedidas por telefone ou email, ainda não saíram",
    icone: CalculatorIcon,
    cor: "text-amber-700",
    fundo: "bg-amber-50",
    visiveis: 6,
  },
  cumprir_compromisso: {
    titulo: "Compromissos assumidos",
    legenda: "O que foi prometido em chamada",
    icone: Handshake,
    cor: "text-blue-700",
    fundo: "bg-blue-50",
    visiveis: 6,
  },
  espera_alfa: {
    titulo: "À espera da Alfa",
    legenda: "Pedidos no Desk cuja próxima jogada é nossa",
    icone: Inbox,
    cor: "text-stone-700",
    fundo: "bg-stone-100",
    visiveis: 5,
  },
  retomar_conversa: {
    titulo: "Conversas por retomar",
    legenda: "Vendas que perderam o embalo",
    icone: TrendingUp,
    cor: "text-violet-700",
    fundo: "bg-violet-50",
    visiveis: 4,
  },
  espera_cliente: {
    titulo: "À espera do cliente",
    legenda: "Parados em cima de outra pessoa — nada a fazer hoje",
    icone: Hourglass,
    cor: "text-stone-500",
    fundo: "bg-stone-100",
    visiveis: 4,
  },
};

/* ── Tempo, em português corrente ───────────────────────────────────────── */

/** "há 3 h", "há 4 dias". Hours below a day; days after, because nobody counts 437 hours. */
export function espera(horas: number): string {
  if (horas < 1) return "agora mesmo";
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** The deadline, said the way a person would say it. */
export function prazoTexto(prazo: string, agora: Date): { texto: string; tarde: boolean } {
  const d = new Date(prazo);
  const horas = Math.round((d.getTime() - agora.getTime()) / 3_600_000);
  if (horas < 0) {
    const atraso = Math.abs(horas);
    return {
      texto: atraso < 24 ? `atrasado ${atraso} h` : `atrasado ${Math.floor(atraso / 24)} dias`,
      tarde: true,
    };
  }
  const hora = d.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  });
  if (horas <= 12) return { texto: `até hoje às ${hora}`, tarde: false };
  if (horas <= 36) return { texto: `até amanhã às ${hora}`, tarde: false };
  return {
    texto: `até ${d.toLocaleDateString("pt-PT", { day: "numeric", month: "short", timeZone: "Europe/Lisbon" })}`,
    tarde: false,
  };
}

/* ── Componentes ────────────────────────────────────────────────────────── */

export function GrupoDeTarefas({
  categoria,
  tarefas,
  agora,
  somenteLeitura,
}: {
  categoria: CategoriaTarefa;
  tarefas: Tarefa[];
  agora: Date;
  /** The preview renders the same panel with nothing that writes. */
  somenteLeitura?: boolean;
}) {
  const a = ASPETO[categoria];
  const [tudo, setTudo] = useState(false);
  const mostradas = tudo ? tarefas : tarefas.slice(0, a.visiveis);
  const escondidas = tarefas.length - mostradas.length;
  const Icone = a.icone;

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {/* The heading carries the icon, the count and the one-line explanation.
          The explanation is not decoration: "à espera do cliente" and "à espera
          da Alfa" are indistinguishable to somebody reading fast, and getting
          that pair the wrong way round is the difference between chasing a
          customer and ignoring one. */}
      <header className={cn("flex items-start gap-2.5 px-3 py-2.5", a.fundo)}>
        <span
          className={cn(
            "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/70",
            a.cor,
          )}
        >
          <Icone className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn("t-micro", a.cor)}>
            {a.titulo}
            <span className="ml-1.5 tabular-nums opacity-60">{tarefas.length}</span>
          </h2>
          <p className="t-meta mt-0.5 text-stone-500">{a.legenda}</p>
        </div>
      </header>

      <div className="divide-y divide-stone-100">
        {mostradas.map((t) => (
          <LinhaTarefa key={t.id} t={t} agora={agora} somenteLeitura={somenteLeitura} />
        ))}
      </div>

      {escondidas > 0 && (
        <button
          className="t-meta w-full border-t border-stone-200 bg-stone-50 py-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
          onClick={() => setTudo(true)}
        >
          mostrar mais {escondidas}
        </button>
      )}
    </section>
  );
}

function LinhaTarefa({
  t,
  agora,
  somenteLeitura,
}: {
  t: Tarefa;
  agora: Date;
  somenteLeitura?: boolean;
}) {
  const urgente = t.prioridade === "alta";
  const prazo = t.prazo ? prazoTexto(t.prazo, agora) : null;
  const razao = porqueMe(t.atribuicaoOrigem);

  return (
    <div
      className={cn(
        "px-3 py-2.5",
        // A left rule rather than a red background: on a list of thirty rows a
        // tinted background is a wall, a rule is a scannable edge.
        urgente && "border-l-[3px] border-l-red-600 pl-[9px]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="t-titulo min-w-0 flex-1 text-stone-900">{t.titulo}</h3>
        {t.esperaHoras != null && (
          <span
            className={cn(
              "t-meta shrink-0 tabular-nums",
              urgente ? "text-red-600" : "text-stone-400",
            )}
          >
            {espera(t.esperaHoras)}
          </span>
        )}
      </div>

      <Contacto t={t} />

      {/* The call's own sentence. Without it the row is a label; with it the
          agent knows what the conversation was about without opening a thing. */}
      {t.porque && <p className="t-narrativa mt-1 text-stone-600">{t.porque}</p>}

      {/* Why this landed on this agent. Only the missed calls have it, and only
          they need it: a call attributed by history rather than by a ticket is
          an inference, and an agent double-checking one is right to. */}
      {razao && <p className="mt-1 t-meta text-stone-400">{razao}</p>}

      {(prazo || t.estado || t.deskUrl) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {prazo && (
            <span
              className={cn(
                "t-meta rounded px-1.5 py-0.5",
                prazo.tarde ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600",
              )}
            >
              {prazo.texto}
            </span>
          )}
          {t.estado && (
            <span className="t-meta rounded bg-stone-100 px-1.5 py-0.5 text-stone-500">
              {t.estado}
            </span>
          )}
          {t.deskUrl && (
            <a
              href={t.deskUrl}
              target="_blank"
              rel="noreferrer"
              className="t-meta inline-flex items-center gap-0.5 text-stone-400 transition-colors hover:text-stone-900"
            >
              abrir no Desk
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      )}

      {t.devolucaoIds && !somenteLeitura && <Fechar ids={t.devolucaoIds} />}
    </div>
  );
}

/**
 * The one thing this panel writes: closing a missed call.
 *
 * Kept as its own component so the mutation lives with the button rather than
 * in the row, and so the read-only preview is one guard rather than a prop
 * threaded through markup.
 */
function Fechar({ ids }: { ids: number[] }) {
  const qc = useQueryClient();
  const concluir = useMutation({
    // Any id in the group closes the whole group server-side — the same rule
    // the auto-resolution applies. Sending the first is enough.
    mutationFn: (estado: "devolvida" | "dispensada") =>
      enviar(`/api/agente/devolucoes/${ids[0]}/concluir`, { estado }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["painel"] }),
  });

  return (
    <>
      <div className="mt-2.5 flex gap-1.5">
        <button
          className="rounded-md bg-stone-900 px-3 py-1.5 t-body font-medium text-stone-50 transition-opacity disabled:opacity-50"
          disabled={concluir.isPending}
          onClick={() => concluir.mutate("devolvida")}
        >
          Devolvida
        </button>
        <button
          className="rounded-md border border-stone-200 px-3 py-1.5 t-body font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
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
  );
}

/**
 * Who the task is with, and how to reach them.
 *
 * The name comes from whichever Desk ticket saw this number last; a number
 * Desk has never seen shows as a number, which is honestly all anybody knows
 * about that caller yet. Both the phone and the email are rendered when both
 * exist — "para quem" is not answered by a name alone if you then have to go
 * looking for the address.
 */
function Contacto({ t }: { t: Tarefa }) {
  const { nome, telefone: tel, email } = t.contacto;
  if (!nome && !tel && !email) return null;

  return (
    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 t-meta text-stone-500">
      {nome && <span className="font-semibold text-stone-700">{nome}</span>}
      {tel && (
        <a href={`tel:${tel}`} className="tabular-nums hover:text-stone-900">
          {telefone(tel)}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="truncate hover:text-stone-900">
          {email}
        </a>
      )}
    </p>
  );
}

/** Nothing to do. Deliberately warm — an empty list here is a good day. */
export function SemTarefas() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center">
      <CircleCheck className="mx-auto h-6 w-6 text-emerald-500" aria-hidden />
      <p className="t-titulo mt-2 text-stone-900">Nada por fazer</p>
      <p className="t-meta mt-1 text-stone-500">
        Sem chamadas por devolver, simulações por enviar ou compromissos em aberto.
      </p>
    </div>
  );
}
