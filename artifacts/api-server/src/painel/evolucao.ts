import { lisbonDayBoundsISO, somarDias, toLisbonDate } from "../lib/dates.js";

/**
 * Is the panel working? Three curves that answer it, day by day.
 *
 * ## Porque é que isto se calcula e não se acumula
 *
 * A maneira óbvia de ter uma série temporal é gravar um retrato por dia: às
 * 23:59 contar o que está aberto e guardar o número. É óbvia e é pior, por
 * duas razões.
 *
 * A primeira é que só começa a contar no dia em que se liga, e ficaríamos duas
 * semanas com gráficos vazios antes de haver alguma coisa para ver.
 *
 * A segunda é mais séria: um retrato congela a regra que existia nesse dia. Se
 * amanhã mudarmos o que conta como prazo — e já mudámos uma vez, quando o SLA
 * fixo de 24 h deu lugar aos prazos por tipo — o histórico passa a ser uma
 * mistura de duas definições, sem maneira de saber onde é que uma acaba e a
 * outra começa.
 *
 * Uma tarefa tem nascimento e morte, e ambos ficam guardados: uma devolução
 * tem `hora_chamada` e `resolvida_at`, um ticket tem `created_time` e
 * `closed_time`, um follow-up tem a conversa que o gerou e a resposta que o
 * fechou. Com os dois instantes, toda a série se deriva — e deriva-se outra
 * vez, corrigida, se a regra mudar.
 *
 * ## Responder e resolver são duas perguntas, e levam curvas separadas
 *
 * A primeira versão disto media o **fecho** contra o prazo de **primeira
 * resposta**, e o resultado foi 85 % de incumprimento todos os dias — um
 * número que não distingue um dia bom de um mau, logo não mede nada. Um
 * pedido aberto há trinta horas pode ter tido resposta em vinte minutos e
 * estar legitimamente à espera do cliente.
 *
 * São coisas diferentes e agora são medidas em separado:
 *
 *  1. **Horas até à primeira resposta** — mediana. "Quanto tempo o cliente
 *     esperou por sinal de vida?"
 *  2. **Percentagem sem resposta dentro do prazo** — das tarefas cujo prazo de
 *     resposta caiu nesse dia, quantas ainda não tinham tido nenhuma. É contra
 *     isto que o SLA de 24 h faz sentido, porque é isto que ele promete.
 *  3. **Horas até fechar** — mediana. "E quanto tempo até estar resolvido?"
 *     Sem prazo associado, porque não há nenhum prometido.
 *  4. **Abertas ao fim do dia** — o volume acumulado. "Isto está a estabilizar
 *     ou a crescer?" Uma equipa pode responder mais depressa e na mesma
 *     afogar-se.
 *
 * Para uma devolução e para um follow-up, responder *é* fechar — devolver a
 * chamada resolve-a. Só num ticket é que as duas divergem, e era exactamente
 * aí que a medida anterior mentia.
 *
 * Mediana e não média. Duas tarefas esquecidas há três semanas arrastam uma
 * média para onde ela deixa de descrever o dia de ninguém; a mediana diz o que
 * aconteceu à tarefa do meio, que é a pergunta.
 */

/**
 * O primeiro dia da série.
 *
 * Sexta-feira, 11 de setembro de 2026 — o primeiro dia inteiramente analisado
 * depois de a agenda no Railway passar a correr sozinha e de o 409 da manhã
 * estar corrigido. Antes disso os dados existem mas são de um sistema que
 * corria noutras condições, e uma curva que começa num degrau causado por nós
 * é pior do que uma curva que começa mais tarde.
 */
export const INICIO_DA_SERIE = "2026-09-11";

export type FamiliaDeTarefa = "devolucao" | "ticket" | "follow_up";

/** Uma tarefa reduzida ao que a série precisa: quando nasceu, morreu, e o prazo. */
export interface Intervalo {
  familia: FamiliaDeTarefa;
  /** Quem a tinha. `null` quando ninguém estava atribuído. */
  colaboradorId: number | null;
  /** Instante ISO em que passou a ser devida. */
  inicio: string;
  /** Instante ISO em que ficou provada como feita, ou `null` se continua aberta. */
  fim: string | null;
  /**
   * Instante ISO do primeiro sinal de vida para o cliente, ou `null` se ainda
   * não houve nenhum. Numa devolução e num follow-up coincide com `fim`;
   * num ticket é o primeiro comentário de um agente, que costuma ser muito
   * anterior ao fecho.
   */
  primeiraResposta: string | null;
  /**
   * Instante ISO em que a **primeira resposta** devia ter saído, ou `null`
   * quando não há prazo. Não é um prazo de fecho: nada promete uma hora de
   * resolução, e medir o fecho contra o SLA de resposta foi o erro que esta
   * separação corrige.
   */
  prazo: string | null;
}

export interface PontoDaSerie {
  /** Dia de Lisboa, `YYYY-MM-DD`. */
  dia: string;
  /** Quantas estavam abertas no fim deste dia. */
  abertas: number;
  nascidas: number;
  fechadas: number;
  /** Mediana das horas entre nascer e fechar, das que fecharam neste dia. */
  horasAteFechar: number | null;
  /** Mediana das horas até à primeira resposta, das que a tiveram neste dia. */
  horasAtePrimeiraResposta: number | null;
  /** Quantas tiveram a primeira resposta neste dia. */
  responderam: number;
  /** Das que tinham prazo de resposta neste dia, quantas ainda não a tinham tido. */
  transitaramParaAtrasado: number;
  /** Quantas tinham prazo neste dia. Denominador da percentagem. */
  comPrazoNesteDia: number;
  /** `transitaramParaAtrasado / comPrazoNesteDia`, 0–100. `null` sem denominador. */
  percentagemAtrasada: number | null;
}

function instante(iso: string): number {
  return Date.parse(iso);
}

/** Mediana, arredondada a uma casa. `null` numa lista vazia. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  const m =
    ordenados.length % 2 === 1
      ? ordenados[meio]
      : (ordenados[meio - 1] + ordenados[meio]) / 2;
  return Math.round(m * 10) / 10;
}

/** Todos os dias de `de` a `ate`, inclusive. */
export function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  let d = de;
  // Limite de segurança: uma data trocada não pode pendurar o servidor a
  // gerar dias até ao fim do calendário.
  for (let i = 0; i < 400 && d <= ate; i++) {
    dias.push(d);
    d = somarDias(d, 1);
  }
  return dias;
}

/**
 * As três curvas, um ponto por dia.
 *
 * `ate` é normalmente hoje. O dia de hoje conta como qualquer outro: as
 * tarefas ainda abertas contam para `abertas`, e as que hoje passaram o prazo
 * contam para a percentagem. Excluir o dia corrente daria um gráfico que só
 * responde no dia seguinte, e a pergunta é de agora.
 */
export function derivarSerie(
  intervalos: readonly Intervalo[],
  de: string,
  ate: string,
): PontoDaSerie[] {
  const dias = diasEntre(de < INICIO_DA_SERIE ? INICIO_DA_SERIE : de, ate);
  if (dias.length === 0) return [];

  // Pré-calculado uma vez em vez de por dia: com trinta dias e mil tarefas, a
  // diferença entre isto e um filtro dentro do ciclo é trinta mil comparações
  // de datas por pedido.
  const preparados = intervalos.map((i) => {
    const nasceu = instante(i.inicio);
    const fechou = i.fim ? instante(i.fim) : null;
    const respondeu = i.primeiraResposta ? instante(i.primeiraResposta) : null;
    const venceu = i.prazo ? instante(i.prazo) : null;
    return {
      diaNasceu: toLisbonDate(new Date(nasceu)),
      diaFechou: fechou !== null ? toLisbonDate(new Date(fechou)) : null,
      diaRespondeu: respondeu !== null ? toLisbonDate(new Date(respondeu)) : null,
      diaVenceu: venceu !== null ? toLisbonDate(new Date(venceu)) : null,
      nasceu,
      fechou,
      respondeu,
      venceu,
    };
  });

  return dias.map((dia) => {
    // Fim do dia **em Lisboa**, não em UTC. Em setembro Portugal está em
    // UTC+1, por isso o dia acaba às 22:59:59Z: usar o fim do dia UTC puxaria
    // uma hora do dia seguinte para dentro deste, e uma tarefa fechada à
    // meia-noite e meia apareceria aberta na véspera.
    const fimDoDia = instante(lisbonDayBoundsISO(dia)[1]);

    let abertas = 0;
    let nascidas = 0;
    let fechadas = 0;
    let transitaram = 0;
    let comPrazo = 0;
    let responderam = 0;
    const horas: number[] = [];
    const horasResposta: number[] = [];

    for (const p of preparados) {
      if (p.diaNasceu === dia) nascidas++;

      if (p.diaFechou === dia) {
        fechadas++;
        horas.push(Math.max(0, (p.fechou! - p.nasceu) / 3_600_000));
      }

      if (p.diaRespondeu === dia) {
        responderam++;
        horasResposta.push(Math.max(0, (p.respondeu! - p.nasceu) / 3_600_000));
      }

      // Aberta ao fim do dia: já tinha nascido e ainda não tinha fechado.
      // Comparado por instante e não por dia, para que uma tarefa nascida e
      // fechada na mesma tarde não conte como aberta à noite.
      if (p.nasceu <= fimDoDia && (p.fechou === null || p.fechou > fimDoDia)) {
        abertas++;
      }

      if (p.diaVenceu === dia) {
        comPrazo++;
        // Transitou para atrasada se, à hora do prazo, o cliente ainda não
        // tinha tido resposta nenhuma. Responder no próprio dia mas depois da
        // hora conta como atraso — é o que o cliente sentiu. O **fecho** não
        // entra nesta conta: ninguém prometeu uma hora de resolução, e medir
        // o fecho contra o prazo de resposta dava 85 % de incumprimento todos
        // os dias, que é um número sem significado.
        if (p.respondeu === null || p.respondeu > p.venceu!) transitaram++;
      }
    }

    return {
      dia,
      abertas,
      nascidas,
      fechadas,
      horasAteFechar: mediana(horas),
      horasAtePrimeiraResposta: mediana(horasResposta),
      responderam,
      transitaramParaAtrasado: transitaram,
      comPrazoNesteDia: comPrazo,
      percentagemAtrasada:
        comPrazo === 0 ? null : Math.round((transitaram / comPrazo) * 1000) / 10,
    };
  });
}

/** O estado de agora, em números — o que a equipa tem em cima da mesa. */
export interface Agregado {
  abertas: number;
  atrasadas: number;
  porFamilia: Record<FamiliaDeTarefa, { abertas: number; atrasadas: number }>;
}

export function derivarAgregado(
  intervalos: readonly Intervalo[],
  agora: Date = new Date(),
): Agregado {
  const t = agora.getTime();
  const vazio = (): { abertas: number; atrasadas: number } => ({ abertas: 0, atrasadas: 0 });
  const porFamilia: Record<FamiliaDeTarefa, { abertas: number; atrasadas: number }> = {
    devolucao: vazio(),
    ticket: vazio(),
    follow_up: vazio(),
  };

  let abertas = 0;
  let atrasadas = 0;
  for (const i of intervalos) {
    if (i.fim !== null) continue;
    abertas++;
    porFamilia[i.familia].abertas++;
    // Atrasada = passou do prazo **de resposta** sem que o cliente tivesse
    // ouvido nada. Uma tarefa por fechar mas já respondida não está em
    // incumprimento; está em curso.
    if (i.primeiraResposta === null && i.prazo !== null && instante(i.prazo) < t) {
      atrasadas++;
      porFamilia[i.familia].atrasadas++;
    }
  }
  return { abertas, atrasadas, porFamilia };
}
