import { diaCurto } from "@/lib/formatos";

/**
 * Uma série curta de barras, com o último valor em destaque.
 *
 * ## Porque barras e não uma linha
 *
 * A série começa a 11 de setembro. Nos primeiros dias tem três ou quatro
 * pontos, e uma linha entre dois pontos desenha uma tendência que não existe —
 * o olho lê a inclinação como significado. Barras dizem o que cada dia foi e
 * deixam a comparação para quem olha. Quando a série tiver semanas, continuam
 * a ler-se bem, por isso não há um segundo desenho à espera de ser feito.
 *
 * ## Um dia sem valor é um espaço, não um zero
 *
 * A percentagem de atrasos é nula num dia em que nada vencia — e nulo não é
 * zero. Zero diria "não falhámos nada"; a verdade é "não havia nada para
 * cumprir". Desenhar um zero nesse dia faria a curva parecer boa exactamente
 * nos dias em que não diz nada.
 *
 * ## Sem eixo vertical
 *
 * Com cinco a vinte barras e o valor de hoje escrito por extenso ao lado, um
 * eixo com marcas seria mais tinta do que informação. O que falta saber — "isto
 * é alto?" — responde-se comparando as barras umas com as outras, que é para
 * isso que elas estão lado a lado.
 */

export interface Barra {
  dia: string;
  valor: number | null;
}

export function Barras({
  dados,
  formatar,
  altura = 44,
}: {
  dados: readonly Barra[];
  /** Como se escreve um valor no rótulo e na dica. */
  formatar: (v: number) => string;
  altura?: number;
}) {
  const comValor = dados.filter((d) => d.valor !== null) as Array<{ dia: string; valor: number }>;
  if (comValor.length === 0) {
    return (
      <p className="t-meta text-stone-400">
        Ainda não há dias com valor para mostrar.
      </p>
    );
  }

  // O máximo nunca é zero, senão a divisão rebenta e todas as barras ficariam
  // com altura infinita.
  const maximo = Math.max(1, ...comValor.map((d) => d.valor));
  const larguraBarra = 100 / Math.max(dados.length, 1);

  return (
    <div className="flex items-end gap-1" style={{ height: altura }}>
      {dados.map((d) => {
        const valor = d.valor;
        const fraccao = valor === null ? 0 : valor / maximo;
        return (
          <div
            key={d.dia}
            className="flex h-full min-w-1.5 flex-1 items-end"
            style={{ maxWidth: `${Math.max(larguraBarra, 6)}%` }}
            title={
              valor === null
                ? `${diaCurto(d.dia)}: sem dados`
                : `${diaCurto(d.dia)}: ${formatar(valor)}`
            }
          >
            {valor === null ? (
              // Um traço fino ao fundo marca que o dia existiu e não teve
              // valor. Sem ele, um buraco na série é indistinguível do fim
              // dela.
              <div className="h-px w-full rounded-full bg-stone-200" />
            ) : (
              <div
                className="w-full rounded-t bg-indigo-600"
                // Mínimo de 2px: um valor pequeno mas real tem de ser visível,
                // senão lê-se como ausência.
                style={{ height: `${Math.max(fraccao * 100, 4)}%`, minHeight: 2 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Um número em destaque com a sua série por baixo.
 *
 * O número responde "como está hoje". A variação responde "e está melhor?" —
 * comparada com o primeiro dia da série, que é o antes de tudo isto. As barras
 * respondem "foi a direito ou aos altos e baixos?".
 */
export function Cartao({
  titulo,
  explicacao,
  dados,
  formatar,
  /** Para uma métrica em que subir é mau — atrasos, volume por fechar. */
  subirEMau = true,
}: {
  titulo: string;
  explicacao: string;
  dados: readonly Barra[];
  formatar: (v: number) => string;
  subirEMau?: boolean;
}) {
  const comValor = dados.filter((d) => d.valor !== null) as Array<{ dia: string; valor: number }>;
  const ultimo = comValor.at(-1) ?? null;
  const primeiro = comValor[0] ?? null;
  // Uma variação precisa de dois pontos diferentes. Com um só, dizer "0%"
  // seria inventar uma estabilidade que ninguém observou.
  const variacao =
    ultimo && primeiro && comValor.length > 1 ? ultimo.valor - primeiro.valor : null;

  const tomDaVariacao =
    variacao === null || variacao === 0
      ? "text-stone-400"
      : (variacao > 0) === subirEMau
        ? "text-red-600"
        : "text-emerald-600";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="t-micro text-stone-400">{titulo}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="t-pagina text-stone-900">
          {ultimo ? formatar(ultimo.valor) : "—"}
        </span>
        {variacao !== null && (
          <span className={`t-meta ${tomDaVariacao}`}>
            {variacao > 0 ? "+" : ""}
            {formatar(variacao)} desde {diaCurto(primeiro!.dia)}
          </span>
        )}
      </div>
      <div className="mt-3">
        <Barras dados={dados} formatar={formatar} />
      </div>
      <p className="mt-2 t-meta text-stone-400">{explicacao}</p>
    </div>
  );
}
