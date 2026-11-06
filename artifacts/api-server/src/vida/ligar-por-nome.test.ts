import { describe, expect, it } from "vitest";
import { chaveDoNome, ligarPorNome } from "./ligar-por-nome.js";

describe("chaveDoNome", () => {
  it("usa primeiro e último nome, sem acentos nem maiúsculas", () => {
    expect(chaveDoNome("Cláudia  Gaião ")).toBe("claudia gaiao");
    expect(chaveDoNome("Inês Maria Candeias")).toBe("ines candeias");
    expect(chaveDoNome("Rute")).toBeNull();
  });
});

describe("ligarPorNome", () => {
  const users = [
    { id: 1, nome: "Claudia Gaiao" },
    { id: 2, nome: "Inês Candeias" },
    { id: 3, nome: "Ana Rodrigues" },
    { id: 4, nome: "Ana Sofia Rodrigues" },
    { id: 5, nome: "Cláudia Galvão" },
  ];

  it("liga quando o nome bate certo com um só utilizador", () => {
    const r = ligarPorNome(
      [{ id: 10, nome: "Cláudia Gaião" }, { id: 11, nome: "Inês Candeias" }],
      users,
      new Set(),
    );
    expect(r).toEqual([{ colaboradorId: 10, nocrmUserId: 1 }, { colaboradorId: 11, nocrmUserId: 2 }]);
  });

  it("não liga quando há dois utilizadores com o mesmo nome", () => {
    expect(ligarPorNome([{ id: 12, nome: "Ana Rodrigues" }], users, new Set())).toEqual([]);
  });

  it("não usa um utilizador que já está ligado", () => {
    expect(ligarPorNome([{ id: 13, nome: "Inês Candeias" }], users, new Set([2]))).toEqual([]);
  });

  it("não confunde nomes parecidos", () => {
    expect(ligarPorNome([{ id: 14, nome: "Cláudia Galvã" }], users, new Set())).toEqual([]);
  });
});
