import { describe, expect, it } from "vitest";
import {
  colunaDoPrazo,
  comoSai,
  corDoCliente,
  leituraCurta,
  posicaoNaFaixa,
  primeiraTarefa,
  resumoDoDia,
  semMarcas,
} from "./leitura";
import type { Tarefa, TarefasPorPrazo } from "./tipos";

/**
 * As frases que o agente lê. Testadas porque são a parte do painel que fala
 * por ele: uma regra de prova mal escrita aqui promete ao agente uma coisa que
 * o servidor não faz.
 */

const agora = new Date("2026-09-25T09:30:00Z"); // sexta, 10:30 em Lisboa

describe("comoSai", () => {
  it("diz a mesma regra da prova que o servidor aplica", () => {
    // `api-server/src/painel/evidencia.ts`: devolver uma chamada exige uma
    // chamada; uma simulação exige uma resposta; um compromisso aceita as duas.
    expect(comoSai("devolver_chamada")).toMatch(/chamada atendida/);
    expect(comoSai("devolver_chamada")).not.toMatch(/resposta/);
    expect(comoSai("enviar_simulacao")).toMatch(/resposta tua no ticket/);
    expect(comoSai("cumprir_compromisso")).toMatch(/chamada atendida ou uma resposta/);
  });

  it("não promete nada para o que está à espera do cliente", () => {
    expect(comoSai("espera_cliente")).toBeNull();
  });
});

describe("colunaDoPrazo", () => {
  it("atrasada conta o atraso, em horas até dois dias", () => {
    expect(colunaDoPrazo("2026-09-24T16:30:00Z", "atrasado", agora)).toEqual({
      grande: "17 h",
      pequeno: "de atraso",
    });
    expect(colunaDoPrazo("2026-09-21T09:30:00Z", "atrasado", agora).grande).toBe("4 dias");
  });

  it("hoje dá a hora de Lisboa, não a do navegador", () => {
    expect(colunaDoPrazo("2026-09-25T13:00:00Z", "hoje", agora)).toEqual({ grande: "14:00", pequeno: "hoje" });
  });

  it("esta semana dá o dia", () => {
    expect(colunaDoPrazo("2026-09-29T16:00:00Z", "semana", agora)).toEqual({
      grande: "ter 29",
      pequeno: "setembro",
    });
  });
});

function t(id: string): Tarefa {
  return { id } as Tarefa;
}
const vazio: TarefasPorPrazo = { atrasado: [], hoje: [], semana: [], aguardar: [] };

describe("primeiraTarefa", () => {
  it("começa pela atrasada mais antiga", () => {
    expect(primeiraTarefa({ ...vazio, atrasado: [t("a"), t("b")], hoje: [t("h")] })).toEqual({
      tarefa: t("a"),
      balde: "atrasado",
    });
  });
  it("sem atrasadas, começa pela primeira de hoje", () => {
    expect(primeiraTarefa({ ...vazio, hoje: [t("h")] })?.balde).toBe("hoje");
  });
  it("não dá destaque a uma tarefa da semana", () => {
    expect(primeiraTarefa({ ...vazio, semana: [t("s")] })).toBeNull();
  });
});

describe("resumoDoDia", () => {
  it("fala no singular quando é uma", () => {
    expect(resumoDoDia(1, 1)).toBe("Tens 1 tarefa atrasada e 1 para hoje.");
  });
  it("não fala do que é zero", () => {
    expect(resumoDoDia(0, 3)).toBe("Tens 3 para hoje.");
    expect(resumoDoDia(2, 0)).toBe("Tens 2 tarefas atrasadas.");
    expect(resumoDoDia(0, 0)).toBe("Nada atrasado nem para hoje.");
  });
});

describe("leituraCurta", () => {
  it("fica com a primeira de cada lista, e aguenta listas vazias", () => {
    const c = {
      strengths: ["a", "b"],
      blindSpots: [],
      coachingRecommendations: ["c"],
    } as unknown as Parameters<typeof leituraCurta>[0];
    expect(leituraCurta(c)).toEqual({ bem: "a", melhor: null, foco: "c" });
  });
});

describe("semMarcas", () => {
  it("tira o negrito em markdown sem tirar o texto", () => {
    expect(semMarcas("combina **uma data** sempre")).toBe("combina uma data sempre");
  });
});

describe("corDoCliente", () => {
  it("é sempre a mesma para o mesmo nome", () => {
    expect(corDoCliente("Carla Sousa")).toBe(corDoCliente("Carla Sousa"));
  });
});

describe("posicaoNaFaixa", () => {
  it("põe as 14h de Lisboa a meio da faixa 08h–20h", () => {
    expect(posicaoNaFaixa("2026-09-25T13:00:00Z")).toBe(50);
  });
  it("fica de fora antes das 8h e depois das 20h", () => {
    expect(posicaoNaFaixa("2026-09-25T05:00:00Z")).toBeNull();
    expect(posicaoNaFaixa("2026-09-25T20:30:00Z")).toBeNull();
  });
});
