import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalculatorIcon,
  CircleCheck,
  Handshake,
  Hourglass,
  Check,
  Circle,
  Inbox,
  PhoneIncoming,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { enviar } from "@/lib/api";
import { porqueMe, telefone } from "@/lib/formatos";
import type { Cadeia, CategoriaTarefa, Passo, Tarefa, TarefaFechada } from "@/lib/tipos";

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


/* ── A cadeia ───────────────────────────────────────────────────────────── */

const NOME_DO_PASSO: Record<Passo["passo"], string> = {
  pedido: "Pedido",
  simulacao: "Simulação",
  follow_up: "Follow-up",
};

/** "25/08", from an ISO instant. The year is noise on a list about this week. */
function diaCurto(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Lisbon",
  });
}

/**
 * The three steps, with the missing one marked.
 *
 * This is the row's argument in one line: the customer asked, the quote went
 * out, nobody followed up. Reading it takes about as long as reading the
 * heading, and it is the difference between "there is a ticket" and "there is
 * a gap".
 *
 * Rendered only when at least two steps are meaningful. A single "Pedido ✓" is
 * a chain of one, which explains nothing and costs a line on every row.
 */
function CadeiaDaTarefa({ cadeia }: { cadeia: Cadeia }) {
  const passos = cadeia.passos.filter((p) => p.estado !== "nao_aplicavel");
  if (passos.length < 2) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
      {passos.map((p, i) => (
        <span key={p.passo} className="flex items-center gap-1">
          {i > 0 && <span className="mr-1 h-px w-3 bg-stone-200" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 t-meta",
              p.estado === "feito"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 font-medium text-red-700",
            )}
          >
            {p.estado === "feito" ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : (
              <Circle className="h-2.5 w-2.5" aria-hidden />
            )}
            {NOME_DO_PASSO[p.passo]}
            {p.quando && <span className="tabular-nums opacity-70">{diaCurto(p.quando)}</span>}
            {p.estado === "em_falta" && <span>em falta</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Why the task is still here, said as the thing that was looked for and not
 * found.
 *
 * A panel that decides what you owe without showing its working asks to be
 * believed. This line is what makes it arguable instead: an agent who knows
 * they called yesterday can see that the lookup missed, and say so.
 */
function PorqueAberta({ texto }: { texto: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 t-meta text-stone-400">
      <Search className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{texto}</span>
    </p>
  );
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

      {t.cadeia && <CadeiaDaTarefa cadeia={t.cadeia} />}

      {/* Why this landed on this agent. Only the missed calls have it, and only
          they need it: a call attributed by history rather than by a ticket is
          an inference, and an agent double-checking one is right to. */}
      {razao && <p className="mt-1 t-meta text-stone-400">{razao}</p>}

      {t.porqueAberta && <PorqueAberta texto={t.porqueAberta} />}

      {(prazo || t.estado || t.deskUrl) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {prazo && (
            <span
              className={cn(
                "t-meta rounded px-1.5 py-0.5",
                prazo.tarde ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600",
              )}
              // The reason belongs next to the date, not in a legend: an agent
              // argues with "we think two days is fair" and does not argue with
              // "you told the customer Monday morning".
              title={t.prazoPorque ?? undefined}
            >
              {prazo.texto}
              {t.prazoPorque && (
                <span className="ml-1 font-normal opacity-60">· {t.prazoPorque}</span>
              )}
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
              // `noopener` as well as `noreferrer`: the panel runs inside a
              // Zoho widget, and a tab opened from it must not keep a handle
              // back to the window it came from.
              rel="noopener noreferrer"
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

/**
 * What closed itself, and the proof that closed it.
 *
 * This card exists because of something the panel takes away. A "Devolvida"
 * button gives the agent a receipt: they press it, the row goes, the system
 * clearly noticed. Closing tasks by evidence instead is more honest — the
 * record decides, not a claim — but it removes that receipt, and a list that
 * silently loses rows reads as forgetful rather than as attentive.
 *
 * So the receipt moves here, and gets better in the process: it no longer says
 * "you said you did this", it says *"chamada atendida de 6 min a 05/09"*.
 */
export function FecharamSozinhas({ fechadas }: { fechadas: TarefaFechada[] }) {
  const [tudo, setTudo] = useState(false);
  if (fechadas.length === 0) return null;
  const mostradas = tudo ? fechadas : fechadas.slice(0, 4);

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <header className="flex items-start gap-2.5 bg-emerald-50 px-3 py-2.5">
        <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/70 text-emerald-700">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="t-micro text-emerald-800">
            Fecharam-se sozinhas
            <span className="ml-1.5 tabular-nums opacity-60">{fechadas.length}</span>
          </h2>
          <p className="t-meta mt-0.5 text-stone-500">
            Nada para marcar — saíram da lista porque o registo mostra que foram feitas
          </p>
        </div>
      </header>

      <ul className="divide-y divide-stone-100">
        {mostradas.map((f) => (
          <li key={f.id} className="px-3 py-2">
            <p className="t-body text-stone-700">
              {f.titulo}
              {f.quem && <span className="text-stone-500"> · {f.quem}</span>}
            </p>
            <p className="t-meta mt-0.5 text-stone-400">{f.prova.descricao}</p>
          </li>
        ))}
      </ul>

      {fechadas.length > mostradas.length && (
        <button
          className="t-meta w-full border-t border-stone-200 bg-stone-50 py-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
          onClick={() => setTudo(true)}
        >
          mostrar mais {fechadas.length - mostradas.length}
        </button>
      )}
    </section>
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
