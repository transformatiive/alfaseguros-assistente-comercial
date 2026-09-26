import { useState } from "react";
import { Indisponivel } from "@/components/Bloco";
import { diaPorExtenso, haQuantoTempo, hora, primeiroNome, saudacao } from "@/lib/formatos";
import { leituraCurta, posicaoNaFaixa, primeiraTarefa, resumoDoDia, semMarcas } from "@/lib/leitura";
import { cn } from "@/lib/utils";
import { BlocoCoaching } from "@/pages/blocos-acoes";
import { AEspera, ComecaPorAqui, Feitas, GrupoPorPrazo, SemTarefas } from "@/pages/tarefas";
import {
  agruparPorPrazo,
  coachingDisponivel,
  estaDisponivel,
  type AgentePainel,
  type Bloco,
  type Coaching,
  type Frescura,
  type Tarefa,
  type TarefasPorPrazo,
} from "@/lib/tipos";

/**
 * The panel's body, shared by the real panel and the preview.
 *
 * **Ordered by when, not by what.** The panel used to group by category —
 * calls here, quotes there, Desk tickets over there. That is the shape of
 * where the rows came from, and it is not the order anybody works in: nobody
 * decides to "do calls now", they do whatever is latest first. Two columns
 * sorted by type made that decision again on every scan.
 *
 * So the left column is an agenda: the one task to start with, then
 * **Atrasadas**, **Hoje** and **Esta semana** — read top to bottom, and
 * nothing is decided. The category is still there, as the small line above
 * each title, which is where it earns its keep.
 *
 * Above it, the day at a glance (the band) and yesterday's reading in three
 * sentences. **The right column is what is done or parked**, not work: what
 * closed itself and why, and who is waiting on the customer.
 */

export function CorpoDoPainel({
  painel,
  aCarregar,
  somenteLeitura,
}: {
  painel: AgentePainel | undefined;
  aCarregar: boolean;
  /** The preview renders the same panel with nothing that writes. */
  somenteLeitura?: boolean;
}) {
  const agora = new Date();
  const piles = agruparPorPrazo(painel?.tarefas ?? [], agora);

  const bloco = painel?.coaching;
  const coaching = bloco && coachingDisponivel(bloco) ? bloco : null;
  const semCoaching = bloco && !coachingDisponivel(bloco) ? bloco : null;

  // A task list cannot say "we could not read your Desk" — a block that failed
  // simply contributes no rows, which on screen is indistinguishable from
  // having none. So the failures are named once, above everything, rather than
  // silently shrinking the list.
  const falhas = painel ? blocosEmFalha(painel) : [];

  if (aCarregar || !painel) return <Esqueleto />;

  const total = piles.atrasado.length + piles.hoje.length + piles.semana.length;
  const primeira = primeiraTarefa(piles);
  // A primeira sai do seu grupo: está lá em cima, em destaque, e repeti-la
  // logo a seguir seria contá-la duas vezes.
  const semAPrimeira = (lista: Tarefa[]) =>
    primeira ? lista.filter((t) => t.id !== primeira.tarefa.id) : lista;
  const atrasadas = semAPrimeira(piles.atrasado);
  const hoje = semAPrimeira(piles.hoje);
  const feitas = painel.fechadas ?? [];

  return (
    <div className="space-y-4">
      <Faixa
        nome={painel.colaborador.nome}
        data={painel.data}
        piles={piles}
        feitas={feitas.length}
        frescura={painel.frescura}
        agora={agora}
      />

      <LeituraCurta c={coaching} motivo={semCoaching?.motivo} />

      {falhas.length > 0 && (
        <div className="space-y-1.5">
          {falhas.map((m) => (
            <Indisponivel key={m} motivo={m} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          {total === 0 && falhas.length === 0 ? (
            <SemTarefas />
          ) : (
            <>
              {primeira && (
                <ComecaPorAqui
                  t={primeira.tarefa}
                  balde={primeira.balde}
                  agora={agora}
                  somenteLeitura={somenteLeitura}
                />
              )}
              <GrupoPorPrazo
                balde="atrasado"
                tarefas={atrasadas}
                agora={agora}
                somenteLeitura={somenteLeitura}
                nota={primeira?.balde === "atrasado" ? `mais ${atrasadas.length}` : undefined}
              />
              <GrupoPorPrazo
                balde="hoje"
                tarefas={hoje}
                agora={agora}
                somenteLeitura={somenteLeitura}
                nota={primeira?.balde === "hoje" ? `mais ${hoje.length}` : undefined}
              />
              <GrupoPorPrazo
                balde="semana"
                tarefas={piles.semana}
                agora={agora}
                somenteLeitura={somenteLeitura}
              />
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-5 rounded-md bg-white px-5 py-5 shadow-[0_1px_2px_rgba(20,32,43,.06)] [&>section+section]:border-t [&>section+section]:border-stone-200 [&>section+section]:pt-5">
          <Feitas fechadas={feitas} />
          <AEspera tarefas={piles.aguardar} />
        </aside>
      </div>

      <p className="border-t border-stone-200 pt-3 t-meta text-stone-400">
        As tarefas saem da lista sozinhas quando o telefone ou o Desk mostram que foram feitas.
        Prazos e leitura das chamadas às 08:00 e às 16:30.
      </p>
    </div>
  );
}

/**
 * O dia de relance: quem, que dia, quanto já se fez e quanto falta.
 *
 * A saudação não é decoração. Este painel diz a alguém o que ainda não fez;
 * abrir com o nome da pessoa é a diferença entre o recado de um colega e uma
 * auditoria.
 *
 * A faixa por baixo desenha o dia: as atrasadas num bloco à esquerda, a linha
 * do "agora", as tarefas de hoje na hora do prazo, as da semana à direita.
 * Três números soltos (2 · 2 · 2) obrigavam a ler três rótulos para perceber
 * o que isto desenha de uma vez.
 */
function Faixa({
  nome,
  data,
  piles,
  feitas,
  frescura,
  agora,
}: {
  nome: string;
  data: string;
  piles: TarefasPorPrazo;
  feitas: number;
  frescura?: Frescura;
  agora: Date;
}) {
  const porFazer = piles.atrasado.length + piles.hoje.length + piles.semana.length;
  const total = feitas + porFazer;
  const doDia = data === hojeEmLisboa(agora);
  const agoraX = doDia ? posicaoNaFaixa(agora.toISOString()) : null;
  const pontos = piles.hoje
    .map((t) => ({ t, x: t.prazo ? posicaoNaFaixa(t.prazo) : null }))
    .filter((p): p is { t: Tarefa; x: number } => p.x !== null);

  return (
    <section className="rounded-md bg-[#14202B] px-5 py-6 text-[#F3F5F6] sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="t-micro text-[#9FB0BC]">{diaPorExtenso(data)}</div>
          <h1 className="t-saudacao mt-2">
            {saudacao(agora)}, {primeiroNome(nome)}.
          </h1>
          <p className="mt-2 max-w-[52ch] text-[17px] leading-snug text-[#9FB0BC]">
            <Resumo atrasado={piles.atrasado.length} hoje={piles.hoje.length} />
          </p>
        </div>
        <Anel feitas={feitas} total={total} />
      </div>

      <div className="mt-5 grid grid-cols-[5rem_minmax(0,1fr)_5rem] gap-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_6.5rem]">
        <div
          className={cn(
            "flex flex-col justify-center rounded px-3 py-2",
            piles.atrasado.length > 0 ? "bg-[#C8372D] text-white" : "bg-white/5 text-[#9FB0BC]",
          )}
        >
          <b className="font-mono text-2xl leading-none">{piles.atrasado.length}</b>
          <span className="mt-1 t-micro">atrasadas</span>
        </div>

        <div className="relative h-[74px] rounded bg-white/5" aria-label="Tarefas de hoje por hora do prazo">
          {[9, 11, 13, 15, 17, 19].map((h) => {
            const x = ((h - 8) / 12) * 100;
            return (
              <span key={h}>
                <span className="absolute bottom-[22px] top-0 w-px bg-white/10" style={{ left: `${x}%` }} />
                <span
                  className="absolute bottom-1.5 hidden -translate-x-1/2 font-mono text-[11px] text-[#9FB0BC] sm:block"
                  style={{ left: `${x}%` }}
                >
                  {h}h
                </span>
              </span>
            );
          })}
          {agoraX !== null && (
            <>
              <span className="absolute inset-y-0 left-0 rounded-l bg-white/5" style={{ width: `${agoraX}%` }} />
              <span className="absolute bottom-[18px] top-0 w-0.5 bg-[#FFD166]" style={{ left: `${agoraX}%` }}>
                <span className="absolute -top-0.5 left-1.5 text-[11px] font-bold text-[#FFD166]">agora</span>
              </span>
            </>
          )}
          {pontos.map(({ t, x }) => (
            <span
              key={t.id}
              className="absolute top-6 flex -translate-x-1/2 flex-col items-center gap-0.5"
              style={{ left: `${x}%` }}
            >
              <i className="h-3.5 w-3.5 rounded-full border-2 border-[#14202B] bg-[#6FD0D8]" />
              <small className="hidden whitespace-nowrap text-[11.5px] font-semibold sm:block">
                {hora(t.prazo!)}
                {t.contacto.nome ? ` ${primeiroNome(t.contacto.nome)}` : ""}
              </small>
            </span>
          ))}
        </div>

        <div className="flex flex-col justify-center rounded bg-white/5 px-3 py-2">
          <b className="font-mono text-2xl leading-none">{piles.semana.length}</b>
          <span className="mt-1 t-micro text-[#9FB0BC]">esta semana</span>
        </div>
      </div>

      <Relogios frescura={frescura} agora={agora} />
    </section>
  );
}

function Resumo({ atrasado, hoje }: { atrasado: number; hoje: number }) {
  // A frase vem de `resumoDoDia`; aqui só se pintam os dois números que a
  // decidem. O vermelho é só para as atrasadas: é o único que quer dizer que
  // alguém está à espera.
  const frase = resumoDoDia(atrasado, hoje);
  const partes = frase.split(/(\d+ tarefas? atrasadas?|\d+ para hoje)/);
  return (
    <>
      {partes.map((p, i) =>
        /atrasad/.test(p) ? (
          <b key={i} className="font-bold text-[#FF8A80]">{p}</b>
        ) : /para hoje/.test(p) ? (
          <b key={i} className="font-bold text-white">{p}</b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {(atrasado > 0 || hoje > 0) && " Começa pela primeira; o resto está por ordem de prazo."}
    </>
  );
}

/**
 * Quantas já saíram da lista, num anel que enche.
 *
 * "Já feitas" e não "feitas hoje": são as tarefas que o painel teria mostrado
 * mas que já têm prova — uma chamada atendida, uma resposta no ticket —, e a
 * prova pode ser de ontem ou de há dias.
 */
function Anel({ feitas, total }: { feitas: number; total: number }) {
  const C = 97.4; // 2πr com r = 15.5
  const cheio = total > 0 ? (feitas / total) * C : 0;
  return (
    <div className="flex items-center gap-3.5" aria-label={`${feitas} de ${total} feitas`}>
      <svg viewBox="0 0 36 36" className="h-[72px] w-[72px]" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="#5FD39A"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${cheio.toFixed(1)} ${C}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div>
        <b className="block font-mono text-[22px]">
          {feitas} de {total}
        </b>
        <span className="text-[13px] text-[#9FB0BC]">já feitas</span>
      </div>
    </div>
  );
}

/**
 * Os dois relógios, numa linha por baixo da faixa.
 *
 * São dois porque são mesmo dois, e andam a ritmos diferentes: as tarefas
 * seguem a sincronização de quinze em quinze minutos, a leitura segue a
 * análise de duas vezes ao dia. Juntá-los numa frase só obrigaria a escolher
 * qual deles mentir.
 */
function Relogios({ frescura, agora }: { frescura?: Frescura; agora: Date }) {
  if (!frescura) return null;
  return (
    <p className="mt-3 t-meta text-[#9FB0BC]">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" aria-hidden />
      Tarefas atualizadas {frescura.sincronizacao ? haQuantoTempo(frescura.sincronizacao, agora) : "—"}
      {" · "}a lista atualiza-se de 15 em 15 minutos
    </p>
  );
}

/**
 * A leitura das chamadas em três frases: correu bem, pode ser melhor, foco de
 * hoje. É o que se lê em cinco segundos antes de pegar no telefone.
 *
 * Antes havia duas leituras — um parágrafo à direita e três listas no fundo —
 * e nenhuma das duas se lia de relance. O resto continua a um clique.
 *
 * Diz sempre de que dia é: a leitura é escrita depois de o dia acabar, e a de
 * sexta lida numa segunda tem de dizer que é de sexta.
 */
function LeituraCurta({ c, motivo }: { c: Coaching | null; motivo?: string }) {
  const [tudo, setTudo] = useState(false);
  if (!c) {
    return motivo ? <p className="px-0.5 t-meta text-stone-500">{motivo}</p> : null;
  }
  const { bem, melhor, foco } = leituraCurta(c);
  if (!bem && !melhor && !foco) return null;

  const colunas = [
    { titulo: "Correu bem", texto: bem, cor: "text-emerald-700", ponto: "bg-emerald-700" },
    { titulo: "Pode ser melhor", texto: melhor, cor: "text-amber-700", ponto: "bg-amber-600" },
    { titulo: "Foco de hoje", texto: foco, cor: "text-teal-700", ponto: "bg-teal-700" },
  ].filter((x) => x.texto);

  return (
    <section className="rounded-md bg-white shadow-[0_1px_2px_rgba(20,32,43,.06)]" aria-label="A tua leitura">
      <div className="grid md:grid-cols-3">
        {colunas.map((x, i) => (
          <div
            key={x.titulo}
            className={cn("px-5 py-4", i > 0 && "border-t border-stone-200 md:border-l md:border-t-0")}
          >
            <h2 className={cn("flex items-center gap-2 t-micro", x.cor)}>
              <span className={cn("h-2 w-2 rounded-full", x.ponto)} aria-hidden />
              {x.titulo}
            </h2>
            <p className="mt-1.5 text-[15px] leading-snug text-stone-800">{semMarcas(x.texto!)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-stone-200 px-5 py-2.5 t-meta text-stone-500">
        <span>Leitura das tuas chamadas de {diaPorExtenso(c.data)}</span>
        <span className="flex flex-wrap items-center gap-x-4">
          {c.closingRateObservations && <span>{semMarcas(c.closingRateObservations)}</span>}
          <button
            type="button"
            aria-expanded={tudo}
            onClick={() => setTudo((v) => !v)}
            className="font-semibold text-teal-800 underline underline-offset-[3px]"
          >
            {tudo ? "Esconder" : "Ver a leitura completa"}
          </button>
        </span>
      </div>
      {tudo && (
        <div className="space-y-3 border-t border-stone-200 px-5 py-4">
          {c.paragraphOverview && <p className="t-narrativa text-stone-700">{c.paragraphOverview}</p>}
          <BlocoCoaching c={c} semTitulo />
        </div>
      )}
    </section>
  );
}

/** `YYYY-MM-DD` de hoje, no calendário de Lisboa. */
function hojeEmLisboa(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
}

/** The `motivo` of every block that could not be built. */
function blocosEmFalha(p: AgentePainel): string[] {
  // Typed as `Bloco<unknown>`: the four blocks hold four different row types,
  // and all this needs from them is whether they are an array at all.
  const blocos: Bloco<unknown>[] = [p.devolucoes, p.ticketsEmRisco, p.followUps, p.acoes];
  const fora: string[] = [];
  for (const b of blocos) {
    if (!estaDisponivel(b)) fora.push(b.motivo);
  }
  // The same identity problem produces the same sentence on several blocks —
  // saying it four times is noise, not four pieces of information.
  return [...new Set(fora)];
}

function Esqueleto() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-xl bg-stone-200/70" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-72 animate-pulse rounded-xl bg-stone-200/70" />
        <div className="h-48 animate-pulse rounded-xl bg-stone-200/70" />
      </div>
    </div>
  );
}
