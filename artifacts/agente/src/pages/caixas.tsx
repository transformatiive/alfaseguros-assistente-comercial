import { useState } from "react";
import { hora, telefone } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import type { Caixa, Caixas, ChaveCaixa, LinhaCaixa } from "@/lib/tipos";

/**
 * As quatro caixas do topo do painel, pedidas pelo coordenador.
 *
 * Cada caixa mostra um número. Clicar no número abre a lista; clicar numa
 * linha abre o ticket no Desk. O número fica a vermelho quando há linhas fora
 * do prazo. O mesmo componente serve o painel de cada pessoa e a vista da
 * equipa (onde cada linha diz também de quem é).
 */

const DEFINICOES: Record<ChaveCaixa, { titulo: string; regra: string; vermelho: string }> = {
  simulacoesPorEnviar: {
    titulo: "Simulações por enviar",
    regra: "O cliente já mandou a informação e a simulação ainda não saiu.",
    vermelho: "mais de 24 h, sem contar fins de semana",
  },
  simulacoesSemSeguimento: {
    titulo: "Simulações sem seguimento",
    regra: "A simulação saiu e depois não houve chamada atendida nem resposta do cliente.",
    vermelho: "mais de 2 horas úteis desde o envio",
  },
  rgpdEmFalta: {
    titulo: "RGPD em falta",
    regra: 'Tickets fechados com o RGPD ainda "Solicitado". Ao mudar para "Angariado", sai da lista.',
    vermelho: "",
  },
  contactosMarcados: {
    titulo: "Contactos marcados",
    regra: 'Data e hora de próximo contacto escritas num comentário do ticket (ex.: "Ligar dia 14/11 às 10h").',
    vermelho: "passou a hora marcada",
  },
};

const ORDEM: ChaveCaixa[] = ["simulacoesPorEnviar", "simulacoesSemSeguimento", "rgpdEmFalta", "contactosMarcados"];

const DATA = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Lisbon" });

function quando(iso: string): string {
  return `${DATA.format(new Date(iso))} ${hora(iso)}`;
}

function tempo(horas: number, chave: ChaveCaixa): string {
  if (horas <= 0) return "";
  // A caixa 2 conta horas úteis (09h-19h): passá-las a "dias" de 24 h enganava.
  if (chave === "simulacoesSemSeguimento") return horas < 1 ? "menos de 1 h útil" : `${Math.round(horas)} h úteis`;
  const prefixo = chave === "contactosMarcados" ? "atrasado " : "";
  if (horas < 1) return `${prefixo}menos de 1 h`;
  if (horas < 48) return `${prefixo}${Math.round(horas)} h`;
  return `${prefixo}${Math.floor(horas / 24)} dias`;
}

export function CaixasDoTopo({ caixas, comResponsavel }: { caixas: Caixas; comResponsavel?: boolean }) {
  const [aberta, setAberta] = useState<ChaveCaixa | null>(null);
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {ORDEM.map((k) => (
          <BotaoCaixa
            key={k}
            chave={k}
            caixa={caixas[k]}
            ativa={aberta === k}
            onClick={() => setAberta(aberta === k ? null : k)}
          />
        ))}
      </div>
      {aberta && <ListaCaixa chave={aberta} caixa={caixas[aberta]} comResponsavel={comResponsavel} />}
    </section>
  );
}

function BotaoCaixa({
  chave,
  caixa,
  ativa,
  onClick,
}: {
  chave: ChaveCaixa;
  caixa: Caixa;
  ativa: boolean;
  onClick: () => void;
}) {
  const d = DEFINICOES[chave];
  const vermelho = caixa.vermelhas > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ativa}
      className={cn(
        "rounded-md border bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(20,32,43,.06)] transition-colors",
        ativa ? "border-stone-900" : "border-stone-200 hover:border-stone-400",
      )}
    >
      <div className="t-micro text-stone-500">{d.titulo}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("t-metric-sm tabular-nums", vermelho ? "text-[#C8372D]" : "text-stone-900")}>
          {caixa.total}
        </span>
        {vermelho && chave !== "rgpdEmFalta" && (
          <span className="t-meta tabular-nums text-[#C8372D]">{caixa.vermelhas} fora do prazo</span>
        )}
      </div>
    </button>
  );
}

function ListaCaixa({ chave, caixa, comResponsavel }: { chave: ChaveCaixa; caixa: Caixa; comResponsavel?: boolean }) {
  const d = DEFINICOES[chave];
  return (
    <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
      <p className="border-b border-stone-200 px-4 py-2 t-meta text-stone-500">
        {d.regra}
        {d.vermelho && <> A vermelho: {d.vermelho}.</>}
      </p>
      {caixa.linhas.length === 0 ? (
        <p className="px-4 py-3 t-body text-stone-500">Nada nesta caixa.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-stone-200 overflow-y-auto">
          {caixa.linhas.map((l) => (
            <Linha key={`${chave}-${l.ticketId}`} l={l} chave={chave} comResponsavel={comResponsavel} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Linha({ l, chave, comResponsavel }: { l: LinhaCaixa; chave: ChaveCaixa; comResponsavel?: boolean }) {
  const rotuloData =
    chave === "contactosMarcados" ? "Marcado para" : chave === "rgpdEmFalta" ? "Fechado a" : "Desde";
  return (
    <li>
      <a
        href={l.deskUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5 hover:bg-stone-50",
          l.vermelha && "border-l-[3px] border-l-[#C8372D]",
        )}
      >
        <span className="min-w-0">
          <span className="t-body text-stone-900">
            <span className="tabular-nums text-stone-500">#{l.ticketNumero ?? "—"}</span>{" "}
            {l.cliente ?? (l.telefone ? telefone(l.telefone) : "Cliente sem nome")}
            {comResponsavel && l.responsavel && <span className="text-stone-500"> · {l.responsavel}</span>}
          </span>
          {l.assunto && <span className="block truncate t-meta text-stone-500">{l.assunto}</span>}
          <span className="block t-meta text-stone-400">{l.nota}</span>
        </span>
        <span className="text-right">
          <span className="block t-meta text-stone-500">
            {rotuloData} {quando(l.desde)}
          </span>
          {l.horas > 0 && (
            <span className={cn("block t-meta tabular-nums", l.vermelha ? "text-[#C8372D]" : "text-stone-500")}>
              {tempo(l.horas, chave)}
            </span>
          )}
          <span className="block t-meta text-sky-700">Abrir no Desk</span>
        </span>
      </a>
    </li>
  );
}
