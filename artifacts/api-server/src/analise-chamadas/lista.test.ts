import { describe, expect, it } from "vitest";
import { montarLista, type ChamadaGuiaoLista } from "./lista.js";
import type { EquipaColaborador } from "./agregar.js";

const roster = new Map<string, EquipaColaborador>([
  ["10", "360"],
  ["20", "vida"],
]);

const analise = {
  categoria: "Sinistro",
  produto: "Auto",
  narrativaConversa: "Cliente ligou sobre um sinistro.",
  arcoConversa: "a",
  sentimentoClienteEvolucao: "s",
  qualidadeGlobal: 4,
  continuidade: "c",
  desviosProcedimento: [],
  pontosPositivos: [],
  feedbackSupervisor: "f",
  sugestaoEspecialista: "e",
  followUpNecessario: false,
  followUpDescricao: "",
  riscoPerdaLead: "baixo",
  tags: [],
};

function g(o: Partial<ChamadaGuiaoLista>): ChamadaGuiaoLista {
  return {
    id: 1,
    fonte: "ringover",
    dataHora: new Date("2026-10-21T10:00:00Z"),
    estado: "analisada",
    colaborador: "Ana Rodrigues",
    agenteId: "20",
    tipo: "primeiro",
    resumo: "Primeiro contacto.",
    motivoDescarte: null,
    ...o,
  };
}

describe("montarLista", () => {
  const conversas = [
    { id: 7, dia: "2026-10-20", agenteId: "10", agenteNome: "Rui 360", analise, resultado: null, temTicket: true },
    { id: 8, dia: "2026-10-22", agenteId: "10", agenteNome: "Rui 360", analise: { lixo: true }, resultado: null, temTicket: false },
  ];
  const guiao = [g({}), g({ id: 2, fonte: "sftp", colaborador: "Colaborador Vida", agenteId: null, dataHora: new Date("2026-10-19T10:00:00Z") })];
  const contas = new Map([[1, { cumpriu: 3, nao: 1 }]]);

  it("junta as três fontes, mais recente primeiro, e ignora análises inválidas", () => {
    const r = montarLista({ conversas, guiao, contas, roster, filtros: { fonte: "todas", equipa: "todas", pessoa: null } });
    expect(r.linhas.map((l) => l.chave)).toEqual(["g-1", "c-7", "g-2"]);
    expect(r.linhas[0]).toMatchObject({ equipa: "vida", tema: "1.º Telefonema", notaPct: 75, notaTexto: "75%" });
    expect(r.linhas[1]).toMatchObject({ fonte: "supervisor", equipa: "360", notaPct: 80, notaTexto: "4/5" });
    expect(r.linhas[2]).toMatchObject({ equipa: "campanha", notaPct: null, notaTexto: "—" });
    expect(r.pessoas).toEqual(["Ana Rodrigues", "Colaborador Vida", "Rui 360"]);
  });

  it("filtra por fonte, equipa e pessoa", () => {
    const so = (filtros: Parameters<typeof montarLista>[0]["filtros"]) =>
      montarLista({ conversas, guiao, contas, roster, filtros }).linhas.map((l) => l.chave);
    expect(so({ fonte: "sftp", equipa: "todas", pessoa: null })).toEqual(["g-2"]);
    expect(so({ fonte: "todas", equipa: "360", pessoa: null })).toEqual(["c-7"]);
    expect(so({ fonte: "todas", equipa: "todas", pessoa: "Ana Rodrigues" })).toEqual(["g-1"]);
  });
});
