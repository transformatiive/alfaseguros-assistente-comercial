import { useQuery } from "@tanstack/react-query";
import { Indisponivel } from "@/components/Bloco";
import { Cartao } from "@/components/barras";
import { obter } from "@/lib/api";
import { diaCurto, diaPorExtenso } from "@/lib/formatos";
import type { EvolucaoDaEquipa } from "@/lib/tipos";

/**
 * A vista que responde à única pergunta que justifica o painel existir:
 * **está isto a produzir efeito?**
 *
 * A vista da equipa diz quem está a carregar o quê, hoje. Não diz se hoje é
 * melhor do que a semana passada — e sem isso não há maneira de saber se o
 * painel mudou alguma coisa ou se é só mais um ecrã.
 *
 * Três curvas, e são deliberadamente três e não uma:
 *
 *  - **Horas até fechar** desce se as pessoas estão a responder mais depressa.
 *  - **Percentagem que passa do prazo** desce se estão a cumprir o combinado.
 *  - **Por fechar ao fim do dia** estabiliza se a equipa está a acompanhar o
 *    caudal.
 *
 * As três podem divergir, e é por isso que estão separadas: uma equipa pode
 * estar mais rápida (a primeira desce) e na mesma a afogar-se (a terceira
 * sobe), porque entrou mais trabalho. Um número só escondia isso.
 *
 * Nunca partilham eixo nem gráfico. São medidas de grandezas diferentes —
 * horas, por cento, contagem — e sobrepô-las num só desenho seria a maneira
 * mais rápida de tornar as três ilegíveis.
 */
export function VistaDaEvolucao() {
  const { data, isLoading, error } = useQuery<EvolucaoDaEquipa>({
    queryKey: ["evolucao"],
    queryFn: () => obter<EvolucaoDaEquipa>("/api/supervisor/evolucao"),
    staleTime: 5 * 60_000,
  });

  if (error) {
    return (
      <div className="p-3">
        <Indisponivel motivo="Não foi possível carregar a evolução." />
      </div>
    );
  }

  const serie = data?.serie ?? [];
  const agregado = data?.agregado;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-10 sm:p-4">
      <header className="px-0.5">
        <h1 className="t-display text-stone-900">Está a resultar?</h1>
        <p className="t-micro text-stone-400">
          {data
            ? `De ${diaPorExtenso(data.de)} até ${diaPorExtenso(data.ate)}`
            : " "}
        </p>
      </header>

      {isLoading && <p className="t-meta text-stone-400">A carregar…</p>}

      {agregado && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Numero valor={agregado.abertas} rotulo="Por fechar agora" />
            <Numero
              valor={agregado.atrasadas}
              rotulo="Já passaram do prazo"
              tom={agregado.atrasadas > 0 ? "text-red-600" : undefined}
            />
            <span className="t-meta text-stone-400">
              {agregado.porFamilia.devolucao.abertas} chamadas por devolver ·{" "}
              {agregado.porFamilia.follow_up.abertas} seguimentos ·{" "}
              {agregado.porFamilia.ticket.abertas} pedidos
            </span>
          </div>
        </div>
      )}

      {serie.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Cartao
              titulo="Horas até fechar"
              explicacao="Mediana do tempo entre a tarefa nascer e haver prova de estar feita. Desce se estamos a responder mais depressa."
              dados={serie.map((p) => ({ dia: p.dia, valor: p.horasAteFechar }))}
              formatar={(v) => `${v} h`}
            />
            <Cartao
              titulo="Passaram do prazo"
              explicacao="Das tarefas que venciam nesse dia, quantas ainda estavam por fazer à hora combinada. Dias sem nada a vencer ficam em branco."
              dados={serie.map((p) => ({ dia: p.dia, valor: p.percentagemAtrasada }))}
              formatar={(v) => `${v}%`}
            />
            <Cartao
              titulo="Por fechar ao fim do dia"
              explicacao="O que ficou em cima da mesa. Estabiliza se a equipa está a acompanhar o que entra."
              dados={serie.map((p) => ({ dia: p.dia, valor: p.abertas }))}
              formatar={(v) => String(v)}
            />
          </div>

          {/*
            Os números por extenso. Um gráfico sem os números por trás pede
            confiança cega, e esta é precisamente a vista onde alguém vai
            querer confirmar uma leitura antes de agir sobre ela.
          */}
          <details className="rounded-xl border border-stone-200 bg-white px-4 py-3">
            <summary className="cursor-pointer t-meta text-stone-500">
              Ver os números
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse t-meta">
                <thead>
                  <tr className="text-left text-stone-400">
                    <th className="py-1 pr-4 font-normal">Dia</th>
                    <th className="py-1 pr-4 font-normal">Nasceram</th>
                    <th className="py-1 pr-4 font-normal">Fecharam</th>
                    <th className="py-1 pr-4 font-normal">Horas (mediana)</th>
                    <th className="py-1 pr-4 font-normal">Passaram do prazo</th>
                    <th className="py-1 font-normal">Por fechar</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((p) => (
                    <tr key={p.dia} className="border-t border-stone-100 text-stone-700">
                      <td className="py-1 pr-4 whitespace-nowrap">{diaCurto(p.dia)}</td>
                      <td className="py-1 pr-4">{p.nascidas}</td>
                      <td className="py-1 pr-4">{p.fechadas}</td>
                      <td className="py-1 pr-4">
                        {p.horasAteFechar === null ? "—" : `${p.horasAteFechar} h`}
                      </td>
                      <td className="py-1 pr-4">
                        {p.percentagemAtrasada === null
                          ? "—"
                          : `${p.transitaramParaAtrasado}/${p.comPrazoNesteDia} (${p.percentagemAtrasada}%)`}
                      </td>
                      <td className="py-1">{p.abertas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {data && (
        <p className="px-0.5 t-meta text-stone-400">
          A série começa a {diaPorExtenso(data.inicioDaSerie)}, o primeiro dia
          inteiro com a análise a correr sozinha. Os dias anteriores existem mas
          são de um sistema noutras condições, e abrir a curva com um degrau
          nosso engana mais do que informa.
        </p>
      )}
    </div>
  );
}

function Numero({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`t-pagina ${tom ?? "text-stone-900"}`}>{valor}</span>
      <span className="t-meta text-stone-400">{rotulo}</span>
    </span>
  );
}
