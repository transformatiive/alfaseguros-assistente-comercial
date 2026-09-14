import { describe, expect, it } from "vitest";
import {
  derivarAgregado,
  derivarSerie,
  diasEntre,
  INICIO_DA_SERIE,
  mediana,
  type Intervalo,
} from "./evolucao.js";

/**
 * Em setembro Lisboa está em UTC+1. Quase todos os erros possíveis aqui são
 * erros de fuso, por isso os instantes estão escritos com o offset explícito
 * `+01:00` — escrevê-los em Z e confiar que dá no mesmo é precisamente o
 * descuido que estes testes existem para apanhar.
 */
function tarefa(p: Partial<Intervalo> & { inicio: string }): Intervalo {
  const base: Intervalo = {
    familia: "devolucao",
    colaboradorId: 1,
    fim: null,
    primeiraResposta: null,
    prazo: null,
    ...p,
  };
  // Por omissão, responder é fechar — que é a verdade numa devolução e num
  // follow-up. Um teste que queira separar as duas datas passa
  // `primeiraResposta` explicitamente, como acontece nos tickets.
  if (p.primeiraResposta === undefined) base.primeiraResposta = base.fim;
  return base;
}

describe("mediana", () => {
  it("dá o do meio numa lista ímpar", () => {
    expect(mediana([5, 1, 3])).toBe(3);
  });

  it("dá a média dos dois do meio numa lista par", () => {
    expect(mediana([1, 2, 3, 10])).toBe(2.5);
  });

  it("não se deixa arrastar por um valor extremo, ao contrário da média", () => {
    // A média seria 102.25. A tarefa do meio demorou 2 horas.
    expect(mediana([1, 2, 2, 404])).toBe(2);
  });

  it("é nula sem valores", () => {
    expect(mediana([])).toBeNull();
  });
});

describe("diasEntre", () => {
  it("inclui as duas pontas", () => {
    expect(diasEntre("2026-09-11", "2026-09-14")).toEqual([
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
  });

  it("dá um dia só quando as pontas são iguais", () => {
    expect(diasEntre("2026-09-11", "2026-09-11")).toEqual(["2026-09-11"]);
  });

  it("dá lista vazia quando o fim é anterior ao início", () => {
    expect(diasEntre("2026-09-14", "2026-09-11")).toEqual([]);
  });
});

describe("derivarSerie — abertas ao fim do dia", () => {
  it("conta uma tarefa aberta em todos os dias entre nascer e fechar", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-14T09:00:00+01:00" })],
      "2026-09-11",
      "2026-09-15",
    );
    expect(s.map((p) => p.abertas)).toEqual([1, 1, 1, 0, 0]);
  });

  it("não conta como aberta uma tarefa nascida e fechada no mesmo dia", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-11T17:00:00+01:00" })],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[0].abertas).toBe(0);
    expect(s[0].nascidas).toBe(1);
    expect(s[0].fechadas).toBe(1);
  });

  it("uma tarefa por fechar continua aberta até ao último dia", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00" })],
      "2026-09-11",
      "2026-09-14",
    );
    expect(s.map((p) => p.abertas)).toEqual([1, 1, 1, 1]);
  });

  it("fecha o dia à hora de Lisboa e não à de Greenwich", () => {
    // 23:30 em Lisboa é 22:30Z. Se o fim do dia fosse calculado em UTC, esta
    // tarefa seria dada como fechada só no dia seguinte — e apareceria aberta
    // no fim do dia 11, que é falso.
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-11T23:30:00+01:00" })],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[0].abertas).toBe(0);
    expect(s[0].fechadas).toBe(1);
  });

  it("uma tarefa fechada depois da meia-noite pertence ao dia seguinte", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-12T00:30:00+01:00" })],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[0].abertas).toBe(1);
    expect(s[0].fechadas).toBe(0);
    expect(s[1].fechadas).toBe(1);
  });
});

describe("derivarSerie — horas até fechar", () => {
  it("mede do nascimento ao fecho, em horas", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-11T14:00:00+01:00" })],
      "2026-09-11",
      "2026-09-11",
    );
    expect(s[0].horasAteFechar).toBe(5);
  });

  it("dá a mediana quando várias fecham no mesmo dia", () => {
    const s = derivarSerie(
      [
        tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-11T10:00:00+01:00" }),
        tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim: "2026-09-11T12:00:00+01:00" }),
        tarefa({ inicio: "2026-09-10T09:00:00+01:00", fim: "2026-09-11T21:00:00+01:00" }),
      ],
      "2026-09-11",
      "2026-09-11",
    );
    // 1 h, 3 h e 36 h → a do meio é 3.
    expect(s[0].horasAteFechar).toBe(3);
  });

  it("é nula num dia em que nada fechou", () => {
    const s = derivarSerie([tarefa({ inicio: "2026-09-11T09:00:00+01:00" })], "2026-09-11", "2026-09-11");
    expect(s[0].horasAteFechar).toBeNull();
  });
});

describe("derivarSerie — transição para atrasado", () => {
  it("conta como atrasada a que passou o prazo por fazer", () => {
    const s = derivarSerie(
      [tarefa({ inicio: "2026-09-11T09:00:00+01:00", prazo: "2026-09-12T18:00:00+01:00" })],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[1].comPrazoNesteDia).toBe(1);
    expect(s[1].transitaramParaAtrasado).toBe(1);
    expect(s[1].percentagemAtrasada).toBe(100);
  });

  it("não conta a que fechou antes do prazo", () => {
    const s = derivarSerie(
      [
        tarefa({
          inicio: "2026-09-11T09:00:00+01:00",
          fim: "2026-09-12T10:00:00+01:00",
          prazo: "2026-09-12T18:00:00+01:00",
        }),
      ],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[1].transitaramParaAtrasado).toBe(0);
    expect(s[1].percentagemAtrasada).toBe(0);
  });

  it("conta a que fechou no mesmo dia mas depois da hora", () => {
    // O cliente esperou para lá do que lhe foi prometido. Contar isto como
    // cumprido porque "foi no mesmo dia" seria contar a nosso favor.
    const s = derivarSerie(
      [
        tarefa({
          inicio: "2026-09-11T09:00:00+01:00",
          fim: "2026-09-12T19:00:00+01:00",
          prazo: "2026-09-12T18:00:00+01:00",
        }),
      ],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[1].transitaramParaAtrasado).toBe(1);
  });

  it("dá percentagem nula, e não zero, num dia sem prazos", () => {
    // Zero por cento diria "não falhámos nada"; nulo diz "não havia nada para
    // cumprir". Num gráfico, a diferença é entre um ponto bom e nenhum ponto.
    const s = derivarSerie([tarefa({ inicio: "2026-09-11T09:00:00+01:00" })], "2026-09-11", "2026-09-11");
    expect(s[0].comPrazoNesteDia).toBe(0);
    expect(s[0].percentagemAtrasada).toBeNull();
  });

  it("calcula a percentagem sobre as que venciam nesse dia", () => {
    const venceHoje = (fim: string | null): Intervalo =>
      tarefa({ inicio: "2026-09-11T09:00:00+01:00", fim, prazo: "2026-09-12T18:00:00+01:00" });
    const s = derivarSerie(
      [
        venceHoje("2026-09-12T10:00:00+01:00"),
        venceHoje("2026-09-12T11:00:00+01:00"),
        venceHoje("2026-09-12T12:00:00+01:00"),
        venceHoje(null),
      ],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[1].percentagemAtrasada).toBe(25);
  });
});

describe("derivarSerie — o início da série", () => {
  it("nunca vai atrás de 11/09, mesmo que peçam antes", () => {
    const s = derivarSerie([], "2026-08-01", "2026-09-13");
    expect(s[0].dia).toBe(INICIO_DA_SERIE);
  });

  it("respeita um início posterior", () => {
    const s = derivarSerie([], "2026-09-13", "2026-09-14");
    expect(s.map((p) => p.dia)).toEqual(["2026-09-13", "2026-09-14"]);
  });

  it("uma tarefa anterior ao início da série continua a contar como aberta", () => {
    // Não se conta o nascimento dela — está fora da janela — mas ela está
    // aberta e o volume tem de a incluir, senão o gráfico começa com uma
    // queda que nunca aconteceu.
    const s = derivarSerie(
      [tarefa({ inicio: "2026-08-20T09:00:00+01:00" })],
      "2026-09-11",
      "2026-09-11",
    );
    expect(s[0].abertas).toBe(1);
    expect(s[0].nascidas).toBe(0);
  });
});

describe("derivarAgregado", () => {
  const agora = new Date("2026-09-14T12:00:00+01:00");

  it("conta só as abertas, por família", () => {
    const a = derivarAgregado(
      [
        tarefa({ familia: "devolucao", inicio: "2026-09-14T09:00:00+01:00" }),
        tarefa({ familia: "ticket", inicio: "2026-09-10T09:00:00+01:00" }),
        tarefa({
          familia: "ticket",
          inicio: "2026-09-10T09:00:00+01:00",
          fim: "2026-09-11T09:00:00+01:00",
        }),
        tarefa({ familia: "follow_up", inicio: "2026-09-12T09:00:00+01:00" }),
      ],
      agora,
    );
    expect(a.abertas).toBe(3);
    expect(a.porFamilia.devolucao.abertas).toBe(1);
    expect(a.porFamilia.ticket.abertas).toBe(1);
    expect(a.porFamilia.follow_up.abertas).toBe(1);
  });

  it("conta como atrasada a aberta cujo prazo já passou", () => {
    const a = derivarAgregado(
      [
        tarefa({ inicio: "2026-09-11T09:00:00+01:00", prazo: "2026-09-13T18:00:00+01:00" }),
        tarefa({ inicio: "2026-09-11T09:00:00+01:00", prazo: "2026-09-15T18:00:00+01:00" }),
        tarefa({ inicio: "2026-09-11T09:00:00+01:00" }),
      ],
      agora,
    );
    expect(a.abertas).toBe(3);
    expect(a.atrasadas).toBe(1);
  });

  it("uma tarefa fechada nunca é atrasada, por muito que tenha passado do prazo", () => {
    const a = derivarAgregado(
      [
        tarefa({
          inicio: "2026-09-11T09:00:00+01:00",
          fim: "2026-09-14T09:00:00+01:00",
          prazo: "2026-09-12T18:00:00+01:00",
        }),
      ],
      agora,
    );
    expect(a.abertas).toBe(0);
    expect(a.atrasadas).toBe(0);
  });
});

/**
 * O caso que passou nos testes e falhou em produção.
 *
 * A primeira versão datava o nascimento de um follow-up no fim do dia da
 * conversa (23:59). Uma resposta enviada nessa mesma tarde é anterior a isso e
 * era descartada, por isso nenhum follow-up fechava nunca: 710 abertos, 710 em
 * atraso, cem por cento — que não é um número mau, é um número impossível.
 *
 * Nenhum teste apanhou isto porque todos os testes desta série recebem os
 * intervalos já construídos. A regra que os constrói vive em `evolucao-query`
 * e é a que estava errada. O que se pode fixar aqui é a leitura: uma família
 * inteira a cem por cento, sem um único fecho, é um sintoma e não um dado.
 */
describe("uma família sem nenhum fecho é suspeita, não é informação", () => {
  it("distingue 'nenhuma fechou' de 'nenhuma tinha prazo'", () => {
    const nunca = Array.from({ length: 10 }, () =>
      tarefa({ inicio: "2026-09-11T09:00:00+01:00", prazo: "2026-09-12T09:00:00+01:00" }),
    );
    const s = derivarSerie(nunca, "2026-09-11", "2026-09-12");
    expect(s[1].percentagemAtrasada).toBe(100);
    expect(s[0].fechadas + s[1].fechadas).toBe(0);
    // As duas condições juntas — cem por cento e zero fechos — são o retrato
    // de uma regra de prova partida, não de uma equipa parada.
  });

  it("com fechos reais a percentagem deixa de ser 100", () => {
    const s = derivarSerie(
      [
        tarefa({
          inicio: "2026-09-11T09:00:00+01:00",
          fim: "2026-09-11T16:00:00+01:00",
          prazo: "2026-09-12T09:00:00+01:00",
        }),
        tarefa({ inicio: "2026-09-11T09:00:00+01:00", prazo: "2026-09-12T09:00:00+01:00" }),
      ],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[0].fechadas).toBe(1);
    expect(s[1].percentagemAtrasada).toBe(50);
  });
});


/**
 * O ticket é a única família em que responder e resolver são datas diferentes,
 * e foi por as ter confundido que a curva de incumprimento marcava 85 % todos
 * os dias — um número que não distingue um dia bom de um mau.
 */
describe("responder e resolver são medidas separadas", () => {
  const pedido = (p: Partial<Intervalo>): Intervalo =>
    tarefa({
      familia: "ticket",
      inicio: "2026-09-11T09:00:00+01:00",
      prazo: "2026-09-12T09:00:00+01:00",
      ...p,
    });

  it("um pedido respondido depressa e fechado tarde não está em incumprimento", () => {
    const s = derivarSerie(
      [
        pedido({
          primeiraResposta: "2026-09-11T09:20:00+01:00",
          fim: "2026-09-30T18:00:00+01:00",
        }),
      ],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[0].responderam).toBe(1);
    expect(s[0].horasAtePrimeiraResposta).toBeCloseTo(0.3, 1);
    expect(s[1].transitaramParaAtrasado).toBe(0);
    expect(s[1].percentagemAtrasada).toBe(0);
  });

  it("um pedido sem resposta nenhuma está em incumprimento à hora do prazo", () => {
    const s = derivarSerie([pedido({ primeiraResposta: null })], "2026-09-11", "2026-09-12");
    expect(s[1].transitaramParaAtrasado).toBe(1);
  });

  it("responder depois da hora conta como incumprimento", () => {
    const s = derivarSerie(
      [pedido({ primeiraResposta: "2026-09-12T11:00:00+01:00" })],
      "2026-09-11",
      "2026-09-12",
    );
    expect(s[1].transitaramParaAtrasado).toBe(1);
  });

  it("as duas medianas são independentes uma da outra", () => {
    const s = derivarSerie(
      [
        pedido({
          primeiraResposta: "2026-09-11T10:00:00+01:00",
          fim: "2026-09-11T19:00:00+01:00",
        }),
      ],
      "2026-09-11",
      "2026-09-11",
    );
    expect(s[0].horasAtePrimeiraResposta).toBe(1);
    expect(s[0].horasAteFechar).toBe(10);
  });

  it("no agregado, uma tarefa já respondida não conta como atrasada", () => {
    const agora = new Date("2026-09-14T12:00:00+01:00");
    const a = derivarAgregado(
      [
        pedido({ primeiraResposta: "2026-09-11T09:10:00+01:00", fim: null }),
        pedido({ primeiraResposta: null, fim: null }),
      ],
      agora,
    );
    expect(a.abertas).toBe(2);
    expect(a.atrasadas).toBe(1);
  });
});
