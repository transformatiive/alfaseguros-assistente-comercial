import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Indisponivel } from "@/components/Bloco";
import { Barras } from "@/components/barras";
import { obter } from "@/lib/api";
import { diaCurto, haQuantoTempo, primeiroNome } from "@/lib/formatos";
import type { Adopcao, Granularidade, LinhaDeAdopcao } from "@/lib/tipos";

/**
 * Quem é que abre isto.
 *
 * Todas as outras vistas medem o trabalho da equipa. Esta mede o nosso — e é a
 * única que pode dar uma resposta desagradável sobre o próprio painel. Um
 * painel com os números todos certos que ninguém abre não vale nada, e é uma
 * falha silenciosa: não dá erro, não aparece em log nenhum, e do lado de cá
 * parece tudo bem.
 *
 * ## A lista começa por quem não aparece
 *
 * Ordenada por total crescente, de propósito. Um ranking põe os campeões em
 * cima e enterra no fundo a única informação accionável desta página inteira —
 * de quem é que ainda não se sabe nada. Quem nunca abriu aparece com zero e em
 * primeiro lugar, porque é a linha que faz alguém levantar-se e ir falar com
 * uma pessoa.
 *
 * ## Uma grelha e não uma linha por pessoa
 *
 * Com quinze pessoas e catorze dias, quinze gráficos seriam quinze coisas para
 * comparar à vez, e ninguém compara quinze coisas. A grelha põe tudo num
 * relance: uma linha clara atravessa a página e vê-se logo; uma coluna clara
 * diz que o dia foi fraco para toda a gente, que é outra história (uma quinta
 * cheia de reuniões, não um painel abandonado).
 */
export function VistaDaAdopcao({
  origem,
  chave,
}: {
  /**
   * Igual às outras vistas: a pré-visualização passa a sua origem, que não
   * precisa de token. É uma função e não um texto porque a escala é escolhida
   * aqui dentro — com um endereço fixo, os botões Dia/Semana/Mês mudariam o
   * título e não os dados, que é pior do que não os ter.
   */
  origem?: (granularidade: Granularidade) => string;
  chave?: unknown[];
} = {}) {
  const [granularidade, setGranularidade] = useState<Granularidade>("dia");
  const semToken = origem !== undefined;

  const { data, isLoading, error } = useQuery<Adopcao>({
    queryKey: chave ? [...chave, granularidade] : ["adopcao", granularidade],
    queryFn: async () => {
      if (!semToken) {
        return obter<Adopcao>(`/api/supervisor/adopcao?granularidade=${granularidade}`);
      }
      const res = await fetch(origem(granularidade));
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`);
      return (await res.json()) as Adopcao;
    },
    staleTime: 5 * 60_000,
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar a utilização." />
      </div>
    );
  }

  const linhas = data?.linhas ?? [];
  const periodos = data?.periodos ?? [];
  const comAcesso = linhas.length;
  const nunca = linhas.filter((l) => l.total === 0).length;
  // O último período ainda está a decorrer — hoje, esta semana, este mês. É
  // sobre ele que se age, e por isso é ele que fica no cartão.
  const activosAgora = data?.pessoasPorPeriodo.at(-1) ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-10 sm:p-4">
      <header className="flex flex-wrap items-start justify-between gap-3 px-0.5">
        <div>
          <h1 className="t-display text-stone-900">Quem usa o painel</h1>
          <p className="t-micro text-stone-400">
            {data ? `${diaCurto(data.de)} a ${diaCurto(data.ate)}` : " "}
          </p>
        </div>
        <Selector valor={granularidade} mudar={setGranularidade} />
      </header>

      {isLoading && <p className="t-meta text-stone-400">A carregar…</p>}

      {data && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Numero
              valor={activosAgora}
              de={comAcesso}
              rotulo={ROTULO_DO_AGORA[granularidade]}
            />
            <Numero
              valor={nunca}
              rotulo="nunca abriram nesta janela"
              tom={nunca > 0 ? "text-red-600" : "text-emerald-600"}
            />
            <span className="t-meta text-stone-400">
              {data.visitasPorPeriodo.reduce((a, b) => a + b, 0)} visitas ao todo
            </span>
          </div>

          <div className="mt-3">
            <Barras
              dados={periodos.map((p, i) => ({
                dia: p.inicio,
                valor: data.pessoasPorPeriodo[i] ?? 0,
              }))}
              formatar={(v) => `${v} pessoas`}
            />
            <p className="mt-2 t-meta text-stone-400">
              Pessoas distintas que abriram o painel em cada{" "}
              {NOME_DO_PERIODO[granularidade]}.
            </p>
          </div>
        </div>
      )}

      {linhas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full border-collapse t-meta">
            <thead>
              <tr className="text-stone-400">
                <th className="sticky left-0 bg-white px-3 py-2 text-left font-normal">
                  Pessoa
                </th>
                {periodos.map((p) => (
                  <th key={p.chave} className="px-1 py-2 text-center font-normal whitespace-nowrap">
                    {rotularPeriodo(p.inicio, granularidade)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-normal">Última vez</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <Linha key={l.colaboradorId} linha={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-0.5 t-meta text-stone-400">
        Uma <b>visita</b> é um conjunto de aberturas seguidas com menos de meia
        hora entre elas — quem deixa o separador aberto não conta dez vezes por
        isso. Não fica registado o que cada pessoa viu, só que abriu, qual das
        abas e a que horas.
      </p>
    </div>
  );
}

const ROTULO_DO_AGORA: Record<Granularidade, string> = {
  dia: "abriram hoje",
  semana: "abriram esta semana",
  mes: "abriram este mês",
};

const NOME_DO_PERIODO: Record<Granularidade, string> = {
  dia: "dia",
  semana: "semana",
  mes: "mês",
};

const MES_CURTO = new Intl.DateTimeFormat("pt-PT", { month: "short", timeZone: "UTC" });

/**
 * O cabeçalho de uma coluna.
 *
 * Cada escala precisa de uma etiqueta diferente porque a pergunta muda: num
 * dia quer-se saber qual foi o dia da semana, numa semana basta a segunda-feira
 * que a abre, e num mês o nome do mês chega e o dia só atrapalharia.
 */
function rotularPeriodo(inicio: string, granularidade: Granularidade): string {
  if (granularidade === "dia") return diaCurto(inicio);
  const [y, m, d] = inicio.split("-").map(Number);
  if (granularidade === "mes") {
    return MES_CURTO.format(new Date(Date.UTC(y, m - 1, 1))).replace(/\.$/, "");
  }
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function Linha({ linha }: { linha: LinhaDeAdopcao }) {
  const nunca = linha.total === 0;
  // O máximo é por pessoa e não da tabela inteira. Comparar toda a gente com o
  // recordista faria toda a gente parecer inactiva ao lado dele; a pergunta
  // aqui é se cada pessoa tem um hábito, não quem ganha.
  const maximo = Math.max(1, ...linha.porPeriodo);

  return (
    <tr className="border-t border-stone-100">
      <td
        className={
          "sticky left-0 bg-white px-3 py-1.5 whitespace-nowrap " +
          (nunca ? "text-red-600" : "text-stone-700")
        }
      >
        {primeiroNome(linha.nome)}
        {linha.papel === "supervisor" && (
          <span className="ml-1.5 t-micro text-stone-300">coord.</span>
        )}
      </td>
      {linha.porPeriodo.map((v, i) => (
        <td key={i} className="px-1 py-1.5 text-center">
          <Celula valor={v} maximo={maximo} />
        </td>
      ))}
      <td className="px-3 py-1.5 text-right whitespace-nowrap text-stone-400">
        {linha.ultimaVisita ? haQuantoTempo(linha.ultimaVisita) : "nunca"}
      </td>
    </tr>
  );
}

/**
 * Uma célula da grelha.
 *
 * O zero é um ponto e não um "0": com catorze colunas, catorze zeros escritos
 * enchem a linha de tinta a dizer nada, e o que se procura na grelha é
 * precisamente o contrário — onde é que há alguma coisa. Um ponto discreto diz
 * "este período existiu e foi vazio" sem competir com os que não foram.
 */
function Celula({ valor, maximo }: { valor: number; maximo: number }) {
  if (valor === 0) {
    return <span className="inline-block h-1 w-1 rounded-full bg-stone-200 align-middle" />;
  }
  // Mínimo de 0,25: uma visita real tem de se ver, mesmo ao lado de um dia de
  // dez. A intensidade distingue muito de pouco; a presença é o que importa.
  const intensidade = Math.max(0.25, valor / maximo);
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-white"
      style={{ backgroundColor: `rgba(79, 70, 229, ${intensidade})` }}
      title={`${valor} ${valor === 1 ? "visita" : "visitas"}`}
    >
      {valor}
    </span>
  );
}

function Numero({
  valor,
  de,
  rotulo,
  tom,
}: {
  valor: number;
  de?: number;
  rotulo: string;
  tom?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`t-pagina ${tom ?? "text-stone-900"}`}>
        {valor}
        {de !== undefined && <span className="t-meta text-stone-400">/{de}</span>}
      </span>
      <span className="t-meta text-stone-400">{rotulo}</span>
    </span>
  );
}

function Selector({
  valor,
  mudar,
}: {
  valor: Granularidade;
  mudar: (g: Granularidade) => void;
}) {
  const opcoes: Array<[Granularidade, string]> = [
    ["dia", "Dia"],
    ["semana", "Semana"],
    ["mes", "Mês"],
  ];
  return (
    <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-0.5">
      {opcoes.map(([g, texto]) => (
        <button
          key={g}
          type="button"
          onClick={() => mudar(g)}
          className={
            "rounded-md px-2.5 py-1 t-micro transition-colors " +
            (valor === g
              ? "bg-stone-900 text-stone-50"
              : "text-stone-400 hover:text-stone-700")
          }
        >
          {texto}
        </button>
      ))}
    </div>
  );
}
