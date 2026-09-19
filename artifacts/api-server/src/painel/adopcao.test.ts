import { describe, expect, it } from "vitest";
import {
  derivarAdopcao,
  inicioDaSemana,
  periodoDe,
  periodosEntre,
  semanaIso,
  visitasDe,
  type Acesso,
  type PessoaComAcesso,
} from "./adopcao.js";

const EQUIPA: PessoaComAcesso[] = [
  { id: 1, nome: "Ana", papel: "agente", equipa: "360" },
  { id: 2, nome: "Bruno", papel: "agente", equipa: "360" },
  { id: 3, nome: "Rui", papel: "supervisor", equipa: "360" },
];

function acesso(colaboradorId: number, instante: string, vista = "meu-dia"): Acesso {
  return { colaboradorId, instante, vista };
}

describe("visitasDe", () => {
  it("pedidos seguidos são uma visita só", () => {
    // O painel volta a pedir dados sempre que a pessoa regressa ao separador.
    // Contar pedidos mediria o nosso código, não a atenção de ninguém.
    const base = Date.parse("2026-09-16T09:00:00Z");
    const visitas = visitasDe([base, base + 60_000, base + 5 * 60_000]);
    expect(visitas).toHaveLength(1);
  });

  it("uma pausa maior do que meia hora começa outra visita", () => {
    const base = Date.parse("2026-09-16T09:00:00Z");
    expect(visitasDe([base, base + 31 * 60_000])).toHaveLength(2);
  });

  it("exactamente trinta minutos ainda é a mesma visita", () => {
    // A fronteira é `> 30 min`, não `>=`. Escrito para que mudá-la seja uma
    // decisão e não um acidente.
    const base = Date.parse("2026-09-16T09:00:00Z");
    expect(visitasDe([base, base + 30 * 60_000])).toHaveLength(1);
  });

  it("não depende da ordem de chegada", () => {
    const base = Date.parse("2026-09-16T09:00:00Z");
    expect(visitasDe([base + 31 * 60_000, base])).toHaveLength(2);
  });

  it("uma lista vazia dá zero visitas", () => {
    expect(visitasDe([])).toEqual([]);
  });
});

describe("períodos", () => {
  it("a semana começa à segunda", () => {
    expect(inicioDaSemana("2026-09-16")).toBe("2026-09-14"); // quarta → segunda
    expect(inicioDaSemana("2026-09-14")).toBe("2026-09-14"); // a própria segunda
    expect(inicioDaSemana("2026-09-20")).toBe("2026-09-14"); // domingo, ainda essa
  });

  it("uma semana que atravessa o fim do mês continua uma semana", () => {
    const p = periodoDe("2026-10-01", "semana");
    expect(p.inicio).toBe("2026-09-28");
    expect(p.fim).toBe("2026-10-04");
  });

  it("o mês acaba no último dia real, incluindo fevereiro bissexto", () => {
    expect(periodoDe("2028-02-10", "mes").fim).toBe("2028-02-29");
    expect(periodoDe("2026-02-10", "mes").fim).toBe("2026-02-28");
  });

  it("a semana de fim de ano pertence ao ano da sua quinta-feira", () => {
    // 30/12/2025 é uma terça; a quinta dessa semana já é 01/01/2026.
    expect(semanaIso(inicioDaSemana("2025-12-30"))).toBe("2026-W01");
  });

  it("gera períodos seguidos, sem buracos nem repetições", () => {
    const dias = periodosEntre("2026-09-14", "2026-09-16", "dia");
    expect(dias.map((p) => p.chave)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);

    const semanas = periodosEntre("2026-09-14", "2026-09-30", "semana");
    expect(semanas.map((p) => p.inicio)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);

    const meses = periodosEntre("2026-08-15", "2026-10-02", "mes");
    expect(meses.map((p) => p.chave)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("derivarAdopcao", () => {
  it("quem nunca abriu aparece na mesma, com zero, e aparece primeiro", () => {
    // É a única informação accionável da tabela inteira. Uma lista só com quem
    // apareceu responde à pergunta errada.
    const r = derivarAdopcao({
      acessos: [acesso(1, "2026-09-16T09:00:00Z")],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });

    expect(r.linhas.map((l) => l.nome)).toEqual(["Bruno", "Rui", "Ana"]);
    expect(r.linhas[0].total).toBe(0);
    expect(r.linhas[0].ultimaVisita).toBeNull();
    expect(r.linhas.at(-1)).toMatchObject({ nome: "Ana", total: 1, diasComUso: 1 });
  });

  it("o acesso de alguém sem acesso hoje é ignorado", () => {
    // Um colaborador desactivado não desaparece do histórico, mas a pergunta é
    // sobre quem podia estar a usar isto agora.
    const r = derivarAdopcao({
      acessos: [acesso(99, "2026-09-16T09:00:00Z")],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });
    expect(r.visitasPorPeriodo).toEqual([0]);
    expect(r.linhas.every((l) => l.total === 0)).toBe(true);
  });

  it("conta pessoas distintas por período, não visitas", () => {
    const r = derivarAdopcao({
      acessos: [
        acesso(1, "2026-09-16T09:00:00Z"),
        acesso(1, "2026-09-16T14:00:00Z"), // a mesma pessoa, outra visita
        acesso(2, "2026-09-16T10:00:00Z"),
      ],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });
    expect(r.pessoasPorPeriodo).toEqual([2]);
    expect(r.visitasPorPeriodo).toEqual([3]);
  });

  it("agrupa por semana e por mês sem perder visitas", () => {
    const acessos = [
      acesso(1, "2026-09-14T09:00:00Z"),
      acesso(1, "2026-09-17T09:00:00Z"),
      acesso(1, "2026-09-22T09:00:00Z"), // semana seguinte
    ];
    const semanal = derivarAdopcao({
      acessos,
      pessoas: EQUIPA,
      de: "2026-09-14",
      ate: "2026-09-22",
      granularidade: "semana",
    });
    expect(semanal.visitasPorPeriodo).toEqual([2, 1]);

    const mensal = derivarAdopcao({
      acessos,
      pessoas: EQUIPA,
      de: "2026-09-14",
      ate: "2026-09-22",
      granularidade: "mes",
    });
    expect(mensal.visitasPorPeriodo).toEqual([3]);
  });

  it("um acesso depois das 23h de Lisboa conta no dia de Lisboa, não no dia UTC", () => {
    // Em setembro Portugal está em UTC+1: 23:30Z já é o dia seguinte cá.
    const r = derivarAdopcao({
      acessos: [acesso(1, "2026-09-16T23:30:00Z")],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-17",
      granularidade: "dia",
    });
    expect(r.visitasPorPeriodo).toEqual([0, 1]);
    expect(r.linhas.at(-1)?.diasComUso).toBe(1);
  });

  it("a última visita é a mais recente, mesmo com os acessos desordenados", () => {
    const r = derivarAdopcao({
      acessos: [
        acesso(1, "2026-09-16T16:00:00Z"),
        acesso(1, "2026-09-16T09:00:00Z"),
      ],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });
    expect(r.linhas.at(-1)?.ultimaVisita).toBe("2026-09-16T16:00:00.000Z");
  });

  it("regista que abas é que a pessoa abriu", () => {
    const r = derivarAdopcao({
      acessos: [
        acesso(3, "2026-09-16T09:00:00Z", "meu-dia"),
        acesso(3, "2026-09-16T09:01:00Z", "equipa"),
        acesso(3, "2026-09-16T09:02:00Z", "equipa"),
      ],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });
    expect(r.linhas.at(-1)?.vistas).toEqual(["meu-dia", "equipa"]);
  });

  it("um acesso fora da janela não conta para período nenhum", () => {
    const r = derivarAdopcao({
      acessos: [acesso(1, "2026-08-01T09:00:00Z")],
      pessoas: EQUIPA,
      de: "2026-09-16",
      ate: "2026-09-16",
      granularidade: "dia",
    });
    expect(r.visitasPorPeriodo).toEqual([0]);
    // A Ana fica com zero visitas *na janela*, como toda a gente — por isso não
    // se procura pela última linha, que aqui é um empate a zeros.
    const ana = r.linhas.find((l) => l.nome === "Ana")!;
    expect(ana.total).toBe(0);
    // Mas o dia distinto continua a contar: ela usou mesmo o painel, e apagar
    // isso porque caiu fora da janela escolhida seria dizer uma falsidade.
    expect(ana.diasComUso).toBe(1);
  });
});
