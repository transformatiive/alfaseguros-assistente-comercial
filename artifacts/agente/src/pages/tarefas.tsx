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
  Clock,
  Inbox,
  Phone,
  PhoneIncoming,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { enviar } from "@/lib/api";
import { idade, iniciais, porqueMe, telefone } from "@/lib/formatos";
import { colunaDoPrazo, comoSai, corDoCliente, TIPO_DE_TAREFA } from "@/lib/leitura";
import type {
  BaldeDePrazo,
  Cadeia,
  CategoriaTarefa,
  Passo,
  Tarefa,
  TarefaFechada,
} from "@/lib/tipos";

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
      texto:
        atraso < 24
          ? `atrasada ${atraso} h`
          : Math.floor(atraso / 24) === 1
            ? "atrasada 1 dia"
            : `atrasada ${Math.floor(atraso / 24)} dias`,
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

/* ── Componentes ────────────────────────────────────────────────────────── */

/**
 * O layout de agenda.
 *
 * Cada tarefa lê-se da esquerda para a direita, sempre nos mesmos sítios:
 *
 *     QUANDO   (iniciais)  TIPO DE TAREFA                      telefone
 *     16 h                 O que fazer                          [Abrir no Desk]
 *     de atraso            Porquê, nas palavras da conversa
 *                          Sai da lista com … — Porque está aqui?
 *
 * O prazo tem coluna própria porque é ele que decide a ordem. Antes estava
 * numa etiqueta pequena no fundo do cartão, depois do resto todo, e o
 * "há 4 dias" do canto — que é há quanto tempo espera, não o prazo — era lido
 * como se fosse.
 *
 * Só o que ajuda a agir fica à vista. O resto (a etapa do negócio quando não é
 * a tarefa em destaque, o estado do Desk, o email, porque é que a chamada veio
 * para ti) está em "Porque está aqui?", a um clique.
 */

const ASPETO_PRAZO: Record<
  Exclude<BaldeDePrazo, "aguardar">,
  { titulo: string; cabecalho: string; coluna: string }
> = {
  atrasado: {
    titulo: "Atrasadas",
    cabecalho: "border-red-700 text-red-700",
    coluna: "bg-red-50 text-red-700",
  },
  hoje: {
    titulo: "Hoje",
    cabecalho: "border-teal-700 text-teal-700",
    coluna: "bg-teal-50 text-teal-700",
  },
  semana: {
    titulo: "Esta semana",
    cabecalho: "border-stone-800 text-stone-900",
    coluna: "bg-stone-100 text-stone-800",
  },
};

/** Rows shown before "mostrar mais". The pile you work first shows more. */
const VISIVEIS: Record<Exclude<BaldeDePrazo, "aguardar">, number> = {
  atrasado: 6,
  hoje: 6,
  semana: 4,
};

export function GrupoPorPrazo({
  balde,
  tarefas,
  agora,
  somenteLeitura,
  nota,
}: {
  balde: Exclude<BaldeDePrazo, "aguardar">;
  tarefas: Tarefa[];
  agora: Date;
  /** The preview renders the same panel with nothing that writes. */
  somenteLeitura?: boolean;
  /** Ao lado do título — "mais 1" quando a primeira foi para o destaque. */
  nota?: string;
}) {
  const a = ASPETO_PRAZO[balde];
  const [tudo, setTudo] = useState(false);
  const mostradas = tudo ? tarefas : tarefas.slice(0, VISIVEIS[balde]);
  const escondidas = tarefas.length - mostradas.length;

  if (tarefas.length === 0) return null;

  return (
    <section className="rounded-md bg-white px-5 pt-4 shadow-[0_1px_2px_rgba(20,32,43,.06)]">
      <h2 className={cn("flex items-baseline gap-2.5 border-b pb-2.5 t-grupo", a.cabecalho)}>
        {a.titulo}
        <span className="t-body font-medium text-stone-400 tabular-nums">
          {nota ?? tarefas.length}
        </span>
      </h2>

      <div className="divide-y divide-stone-200">
        {mostradas.map((t) => (
          <LinhaTarefa
            key={t.id}
            t={t}
            balde={balde}
            agora={agora}
            somenteLeitura={somenteLeitura}
          />
        ))}
      </div>

      {escondidas > 0 ? (
        <button
          className="t-meta mb-3 w-full rounded border border-stone-200 py-1.5 text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-900"
          onClick={() => setTudo(true)}
        >
          mostrar mais {escondidas}
        </button>
      ) : (
        <div className="h-1" />
      )}
    </section>
  );
}

/** Iniciais do cliente, numa cor que é sempre a mesma para a mesma pessoa. */
export function Iniciais({ t, grande }: { t: Tarefa; grande?: boolean }) {
  const chave = t.contacto.nome ?? t.contacto.telefone ?? t.contacto.email ?? t.id;
  const texto = t.contacto.nome ? iniciais(t.contacto.nome) : "?";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        grande ? "h-12 w-12 text-base" : "h-9 w-9 text-[13px]",
      )}
      style={{ background: corDoCliente(chave) }}
      aria-hidden
    >
      {texto}
    </span>
  );
}

/**
 * O telefone, à vista e sem ser botão.
 *
 * Dentro do Desk, um `tel:` abre o que o sistema quiser — muitas vezes nada.
 * O número serve para marcar no Ringover; o que importa é estar sempre no
 * mesmo sítio e legível, não ser clicável.
 */
export function Telefone({ numero, grande }: { numero: string; grande?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap font-mono text-stone-700 tabular-nums",
        grande ? "text-[15px]" : "text-[13.5px]",
      )}
    >
      <Phone className="h-3.5 w-3.5 text-stone-400" aria-hidden />
      {telefone(numero)}
    </span>
  );
}

export function BotaoDesk({ url, principal }: { url: string; principal?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      // `noopener` as well as `noreferrer`: the panel runs inside a Zoho
      // widget, and a tab opened from it must not keep a handle back to the
      // window it came from.
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] border font-semibold transition-colors",
        principal
          ? "border-stone-900 bg-stone-900 px-4 py-2.5 text-[14.5px] text-stone-50 hover:bg-stone-700"
          : "border-stone-800 px-3 py-1.5 t-body text-stone-900 hover:bg-stone-900 hover:text-stone-50",
      )}
    >
      {principal ? "Abrir o ticket no Desk" : "Abrir no Desk"}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

/** A linha "tipo de tarefa", com o ícone e a cor da categoria. */
function TipoDeTarefa({ t }: { t: Tarefa }) {
  const marca = ASPETO[t.categoria];
  const Icone = marca.icone;
  const tentativas = t.devolucaoIds && t.devolucaoIds.length > 1 ? ` · ligou ${t.devolucaoIds.length} vezes` : "";
  return (
    <span className={cn("flex items-center gap-1.5 t-micro", marca.cor)}>
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {TIPO_DE_TAREFA[t.categoria]}
      {tentativas}
    </span>
  );
}

function SaiDaLista({ t }: { t: Tarefa }) {
  const como = comoSai(t.categoria);
  if (!como) return null;
  return (
    <p className="mt-1.5 t-meta text-stone-500">
      <b className="font-semibold text-emerald-700">Sai da lista</b> com {como}.
    </p>
  );
}

/**
 * O que sustenta a tarefa, para quem quiser confirmar: o que foi procurado e
 * não se encontrou, porque é que a chamada veio para ti, a etapa do negócio,
 * de onde vem o prazo, o estado no Desk e o email.
 *
 * Fica fechado por omissão. Um painel que decide o que se deve sem mostrar as
 * contas pede para ser acreditado — mas mostrar as contas em todas as linhas,
 * sempre, fazia de cada cartão sete linhas.
 */
function PorqueEstaAqui({ t, agora, semCadeia }: { t: Tarefa; agora: Date; semCadeia?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const razao = porqueMe(t.atribuicaoOrigem);
  const prazo = t.prazo ? prazoTexto(t.prazo, agora) : null;
  const linhas: string[] = [];
  if (t.porqueAberta) linhas.push(t.porqueAberta);
  if (razao) linhas.push(`Veio para ti: ${razao}.`);
  if (prazo && t.prazoPorque) linhas.push(`Prazo: ${prazo.texto} · ${t.prazoPorque}.`);
  if (t.estado) linhas.push(`Estado no Desk: ${t.estado}.`);
  if (t.contacto.email) linhas.push(`Email: ${t.contacto.email}`);
  const temCadeia = !semCadeia && t.cadeia && t.cadeia.passos.filter((p) => p.estado !== "nao_aplicavel").length >= 2;
  if (linhas.length === 0 && !temCadeia) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="t-meta font-semibold text-teal-800 underline underline-offset-[3px]"
      >
        {aberto ? "Esconder" : "Porque está aqui?"}
      </button>
      {aberto && (
        <div className="mt-1.5 space-y-1 t-meta text-stone-600">
          {temCadeia && t.cadeia && <CadeiaDaTarefa cadeia={t.cadeia} />}
          {linhas.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaTarefa({
  t,
  balde,
  agora,
  somenteLeitura,
}: {
  t: Tarefa;
  balde: Exclude<BaldeDePrazo, "aguardar">;
  agora: Date;
  somenteLeitura?: boolean;
}) {
  const coluna = t.prazo ? colunaDoPrazo(t.prazo, balde, agora) : null;
  const a = ASPETO_PRAZO[balde];

  return (
    <article className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 sm:grid-cols-[5.25rem_2.25rem_minmax(0,1fr)_auto]">
      <div className={cn("self-start rounded px-1 py-2 text-center leading-tight", a.coluna)}>
        {coluna && (
          <>
            <div className="font-mono text-[16px] font-semibold tabular-nums">{coluna.grande}</div>
            <div className="mt-0.5 t-micro opacity-90">{coluna.pequeno}</div>
          </>
        )}
      </div>

      <div className="hidden sm:block">
        <Iniciais t={t} />
      </div>

      <div className="min-w-0">
        <TipoDeTarefa t={t} />
        <h3 className="t-titulo mt-1 text-stone-900">{t.titulo}</h3>
        {t.contacto.nome && <p className="t-body font-semibold text-stone-600">{t.contacto.nome}</p>}
        {t.porque && <p className="t-narrativa mt-1 text-stone-600">{t.porque}</p>}
        <SaiDaLista t={t} />
        <PorqueEstaAqui t={t} agora={agora} />
      </div>

      <div className="col-start-2 flex flex-wrap items-start gap-2 sm:col-start-auto sm:flex-col sm:items-end">
        {t.contacto.telefone && <Telefone numero={t.contacto.telefone} />}
        {t.deskUrl && <BotaoDesk url={t.deskUrl} />}
        {t.devolucaoIds && !somenteLeitura && <Fechar ids={t.devolucaoIds} />}
      </div>
    </article>
  );
}

/**
 * Começa por aqui: a tarefa que abre o dia, em destaque.
 *
 * Decidir por onde começar é trabalho, e é trabalho repetido todas as manhãs
 * por cada agente. A ordem já está decidida — o painel só a mostra.
 */
export function ComecaPorAqui({
  t,
  balde,
  agora,
  somenteLeitura,
}: {
  t: Tarefa;
  balde: "atrasado" | "hoje";
  agora: Date;
  somenteLeitura?: boolean;
}) {
  const prazo = t.prazo ? prazoTexto(t.prazo, agora) : null;
  const como = comoSai(t.categoria);
  const passos = t.cadeia?.passos.filter((p) => p.estado !== "nao_aplicavel") ?? [];
  const tarde = balde === "atrasado";

  return (
    <article
      className={cn(
        "border-t-[5px] bg-white px-6 pb-6 pt-5 shadow-[0_1px_2px_rgba(20,32,43,.06),0_10px_30px_rgba(20,32,43,.06)]",
        tarde ? "border-red-700" : "border-teal-700",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("t-micro", tarde ? "text-red-700" : "text-teal-700")}>Começa por aqui</span>
        {prazo && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 font-mono text-[13px] font-semibold text-white",
              tarde ? "bg-red-700" : "bg-teal-700",
            )}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {prazo.texto}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3.5">
        <Iniciais t={t} grande />
        <div className="min-w-0">
          <TipoDeTarefa t={t} />
          <h2 className="t-destaque mt-0.5 text-stone-900">{t.titulo}</h2>
          {t.contacto.nome && <p className="t-body font-semibold text-stone-600">{t.contacto.nome}</p>}
        </div>
      </div>

      {t.prazoPorque && <p className="mt-3 t-body text-stone-600">Prazo: {t.prazoPorque}.</p>}
      {t.porque && (
        <p className="mt-3 border-l-[3px] border-stone-200 pl-3 text-[15px] leading-relaxed text-stone-700">
          {t.porque}
        </p>
      )}

      {passos.length >= 2 && (
        <ol className="mt-4 flex flex-wrap t-body" aria-label="Em que passo está o negócio">
          {passos.map((p, i) => (
            <li
              key={p.passo}
              className={cn(
                "border-stone-200 py-1 pr-3.5",
                i < passos.length - 1 && "mr-3.5 border-r",
                p.estado === "feito" ? "text-emerald-700" : p.estado === "em_falta" && p.passo === t.cadeia?.emFalta ? "font-bold text-red-700" : "text-stone-400",
              )}
            >
              {p.estado === "feito" ? "✓ " : ""}
              {NOME_DO_PASSO[p.passo]}
              {p.quando ? ` · ${diaCurto(p.quando)}` : p.estado === "em_falta" && p.passo === t.cadeia?.emFalta ? " · falta" : ""}
            </li>
          ))}
        </ol>
      )}

      {como && (
        <p className="mt-4 flex gap-2.5 border-t border-stone-200 pt-3.5 t-body text-stone-600">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
          <span>
            Sai da lista sozinha com {como}. Não precisas de marcar nada.
          </span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {t.deskUrl && <BotaoDesk url={t.deskUrl} principal />}
        {t.contacto.telefone && <Telefone numero={t.contacto.telefone} grande />}
        {t.devolucaoIds && !somenteLeitura && <Fechar ids={t.devolucaoIds} />}
      </div>
      <PorqueEstaAqui t={t} agora={agora} semCadeia />
    </article>
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
    <div>
      <div className="flex gap-1.5">
        <button
          className="rounded-[3px] border border-stone-800 px-3 py-1.5 t-body font-semibold text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50 disabled:opacity-50"
          disabled={concluir.isPending}
          onClick={() => concluir.mutate("devolvida")}
        >
          Devolvida
        </button>
        <button
          className="rounded-[3px] border border-stone-200 px-3 py-1.5 t-body font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
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
    </div>
  );
}

/**
 * O que já saiu da lista, e a prova que a fez sair.
 *
 * Existe por causa de uma coisa que o painel tira. Fechar por prova em vez de
 * por clique é mais honesto — decide o registo, não uma declaração —, mas tira
 * ao agente o recibo de ter feito. Uma lista que perde linhas em silêncio
 * parece esquecida, não atenta. O recibo vem para aqui, e melhor: não diz
 * "disseste que fizeste", diz "chamada atendida de 6 min a 05/09".
 */
export function Feitas({ fechadas }: { fechadas: TarefaFechada[] }) {
  const [tudo, setTudo] = useState(false);
  const mostradas = tudo ? fechadas : fechadas.slice(0, 5);

  return (
    <section>
      <h2 className="mb-2.5 flex justify-between t-micro text-stone-500">
        Feito
        <b className="font-mono text-stone-900">{fechadas.length}</b>
      </h2>
      {fechadas.length === 0 ? (
        <p className="t-meta text-stone-400">
          Ainda nada hoje. As tarefas saem daqui sozinhas quando o telefone ou o Desk mostram que foram feitas.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {mostradas.map((f) => (
            <li key={f.id} className="flex gap-2 py-2 first:pt-0">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
              <div className="min-w-0">
                <p className="t-body text-stone-800">
                  {f.titulo}
                  {f.quem && <span className="text-stone-500"> · {f.quem}</span>}
                </p>
                <p className="t-meta text-stone-400">{f.prova.descricao}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {fechadas.length > mostradas.length && (
        <button
          className="t-meta mt-1 font-semibold text-teal-800 underline underline-offset-[3px]"
          onClick={() => setTudo(true)}
        >
          mostrar mais {fechadas.length - mostradas.length}
        </button>
      )}
    </section>
  );
}

/**
 * O que está parado: à espera do cliente, ou sem prazo para já.
 *
 * Nomes, e não caixas com números: "Contigo 0 / Com o cliente 2" obrigava a
 * perguntar "quem?". No máximo cinco de cada; nada disto é trabalho de hoje.
 */
export function AEspera({ tarefas }: { tarefas: Tarefa[] }) {
  if (tarefas.length === 0) return null;
  const cliente = tarefas.filter((t) => t.categoria === "espera_cliente");
  const semPrazo = tarefas.filter((t) => t.categoria !== "espera_cliente");
  return (
    <>
      {cliente.length > 0 && (
        <Parados
          titulo="À espera do cliente"
          tarefas={cliente}
          nota="Nada a fazer. Voltam à lista se passarem 14 dias."
        />
      )}
      {semPrazo.length > 0 && (
        <Parados
          titulo="Sem prazo para já"
          tarefas={semPrazo}
          nota="Contigo, mas sem data esta semana."
        />
      )}
    </>
  );
}

function Parados({ titulo, tarefas, nota }: { titulo: string; tarefas: Tarefa[]; nota: string }) {
  return (
    <section>
      <h2 className="mb-2.5 flex justify-between t-micro text-stone-500">
        {titulo}
        <b className="font-mono text-stone-900">{tarefas.length}</b>
      </h2>
      <ul className="divide-y divide-stone-100">
        {tarefas.slice(0, 5).map((t) => (
          <li key={t.id} className="flex justify-between gap-3 py-2 first:pt-0 t-body text-stone-800">
            <span className="min-w-0 truncate">
              {t.contacto.nome ?? (t.contacto.telefone ? telefone(t.contacto.telefone) : "Sem nome")}
              <span className="text-stone-500"> · {t.titulo}</span>
            </span>
            {t.esperaHoras != null && (
              <span className="shrink-0 font-mono text-[12.5px] text-stone-400">{idade(t.esperaHoras)}</span>
            )}
          </li>
        ))}
      </ul>
      {tarefas.length > 5 && <p className="t-meta text-stone-400">e mais {tarefas.length - 5}</p>}
      <p className="mt-2 t-meta text-stone-400">{nota}</p>
    </section>
  );
}

/** Nothing to do. Deliberately warm — an empty list here is a good day. */
export function SemTarefas() {
  return (
    <div className="rounded-md bg-white px-4 py-10 text-center shadow-[0_1px_2px_rgba(20,32,43,.06)]">
      <CircleCheck className="mx-auto h-7 w-7 text-emerald-600" aria-hidden />
      <p className="t-titulo mt-2 text-stone-900">Nada por fazer</p>
      <p className="t-meta mt-1 text-stone-500">
        Sem chamadas por devolver, simulações por enviar ou compromissos em aberto.
      </p>
    </div>
  );
}
