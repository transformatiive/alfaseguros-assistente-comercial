import { describe, expect, it } from "vitest";
import {
  agruparNaFaixa,
  colunaDoPrazo,
  comoSai,
  numeroDoTicket,
  origemDaTarefa,
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
    expect(comoSai("cumprir_compromisso")).toMatch(/chamada atendida, uma resposta/);
  });

  it("diz que fechar o ticket também tira a tarefa da lista", () => {
    expect(comoSai("enviar_simulacao")).toMatch(/ticket fechado/);
    expect(comoSai("cumprir_compromisso")).toMatch(/ticket fechado/);
    expect(comoSai("espera_alfa")).toMatch(/ticket fechado/);
    // Uma devolução não se fecha pelo ticket: o servidor não a fecha assim.
    expect(comoSai("devolver_chamada")).not.toMatch(/fechado/);
  });
});

describe("origemDaTarefa", () => {
  it("diz a data e a hora da chamada, em Lisboa", () => {
    expect(origemDaTarefa({ chamadaEm: "2026-09-03T14:27:00Z" })).toBe("Chamada de 03/09 às 15:27");
  });

  it("nada quando não houve chamada", () => {
    expect(origemDaTarefa({ chamadaEm: null })).toBeNull();
  });
});

describe("numeroDoTicket", () => {
  it("mostra o número como no Desk", () => {
    expect(numeroDoTicket({ ticketNumero: "185106" })).toBe("#185106");
  });

  it("diz que não há ticket, em vez de deixar em branco", () => {
    expect(numeroDoTicket({ ticketNumero: null })).toBe("Sem ticket");
    expect(numeroDoTicket({ ticketNumero: "" })).toBe("Sem ticket");
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

describe("colunaDoPrazo sem hora combinada", () => {
  it("diz 'fim do dia' em vez de inventar as 18:00", () => {
    expect(colunaDoPrazo("2026-09-25T17:00:00Z", "hoje", agora, "dia")).toEqual({
      grande: "Hoje",
      pequeno: "fim do dia",
    });
  });

  it("mostra a hora só quando ela foi combinada", () => {
    expect(colunaDoPrazo("2026-09-25T15:00:00Z", "hoje", agora, "combinada").grande).toBe("16:00");
    expect(colunaDoPrazo("2026-09-25T11:00:00Z", "hoje", agora, "manha").grande).toBe("Manhã");
  });
});

describe("agruparNaFaixa", () => {
  const base = { prazoHora: "combinada" } as const;
  const t = (id: number, prazo: string, prazoHora: "combinada" | "dia" = "combinada") =>
    ({ ...base, id, prazo, prazoHora, contacto: { nome: `C${id}` } }) as unknown as Tarefa;

  it("põe as tarefas sem hora num só grupo de fim do dia, em vez de empilhar às 18:00", () => {
    const g = agruparNaFaixa([
      t(1, "2026-09-25T17:00:00Z", "dia"),
      t(2, "2026-09-25T17:00:00Z", "dia"),
      t(3, "2026-09-25T17:00:00Z", "dia"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].fimDoDia).toBe(true);
    expect(g[0].tarefas.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("junta as tarefas a menos de uma hora e separa as que estão longe", () => {
    const g = agruparNaFaixa([
      t(1, "2026-09-25T09:00:00Z"), // 10:00 Lisboa
      t(2, "2026-09-25T09:30:00Z"), // 10:30
      t(3, "2026-09-25T13:00:00Z"), // 14:00
    ]);
    expect(g.map((x) => x.tarefas.map((y) => y.id))).toEqual([[1, 2], [3]]);
  });

  it("uma tarefa combinada para as 18:30 não se mistura com o fim do dia", () => {
    const g = agruparNaFaixa([t(1, "2026-09-25T17:30:00Z"), t(2, "2026-09-25T17:00:00Z", "dia")]);
    expect(g).toHaveLength(2);
    expect(g[1].x - g[0].x).toBeGreaterThanOrEqual(8);
  });
});
