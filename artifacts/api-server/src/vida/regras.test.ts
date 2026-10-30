import { describe, expect, it } from "vitest";
import {
  agendaComEstado,
  atrasada,
  calcularAlertas,
  calcularResumo,
  eAcao,
  estadoDaAgenda,
  parada,
  type AgendaR,
  type EventoR,
  type LeadR,
} from "./regras.js";

// 29/10/2026 é uma quinta-feira. Lisboa está em UTC+0 (hora de inverno desde 25/10).
const AGORA = new Date("2026-10-29T15:00:00Z");

function lead(p: Partial<LeadR> & { id: number }): LeadR {
  return {
    titulo: `Lead ${p.id}`,
    passo: "Contactado",
    estado: "todo",
    userId: 1,
    valor: null,
    origem: null,
    tags: [],
    criadaEm: new Date("2026-10-01T10:00:00Z"),
    fechadaEm: null,
    proximaAcaoDia: null,
    proximaAcaoHora: null,
    passoDesde: null,
    ...p,
  };
}

function ev(p: Partial<EventoR> & { leadId: number; tipo: string; ocorreuEm: Date }): EventoR {
  return { userId: 1, duracaoSeg: null, valor: null, ...p };
}

const conversa = (leadId: number, iso: string, seg = 120): EventoR => ev({ leadId, tipo: "chamada", duracaoSeg: seg, ocorreuEm: new Date(iso) });
const tentativa = (leadId: number, iso: string): EventoR => ev({ leadId, tipo: "chamada", duracaoSeg: 0, ocorreuEm: new Date(iso) });

describe("eAcao", () => {
  it("conta conversas, notas, emails e mudanças de passo", () => {
    expect(eAcao(conversa(1, "2026-10-29T10:00:00Z"))).toBe(true);
    expect(eAcao(ev({ leadId: 1, tipo: "nota", ocorreuEm: AGORA }))).toBe(true);
    expect(eAcao(ev({ leadId: 1, tipo: "email", ocorreuEm: AGORA }))).toBe(true);
    expect(eAcao(ev({ leadId: 1, tipo: "passo", valor: "Proposta enviada", ocorreuEm: AGORA }))).toBe(true);
  });
  it("não conta tentativas nem a passagem automática para 'todo'", () => {
    expect(eAcao(tentativa(1, "2026-10-29T10:00:00Z"))).toBe(false);
    expect(eAcao(ev({ leadId: 1, tipo: "estado", valor: "todo", ocorreuEm: AGORA }))).toBe(false);
    expect(eAcao(ev({ leadId: 1, tipo: "estado", valor: "won", ocorreuEm: AGORA }))).toBe(true);
    expect(eAcao(ev({ leadId: 1, tipo: "dono", ocorreuEm: AGORA }))).toBe(false);
  });
});

describe("estadoDaAgenda", () => {
  const hoje: AgendaR = { dia: "2026-10-29", leadId: 1, userId: 1, hora: "11:00", passo: "Contactado" };

  it("feito quando houve acção nesse dia", () => {
    expect(estadoDaAgenda(hoje, [conversa(1, "2026-10-29T11:30:00Z")], AGORA)).toBe("feito");
  });
  it("tentou quando só houve chamadas de 0 s", () => {
    expect(estadoDaAgenda(hoje, [tentativa(1, "2026-10-29T11:30:00Z")], AGORA)).toBe("tentou");
  });
  it("acção noutro dia não conta", () => {
    expect(estadoDaAgenda(hoje, [conversa(1, "2026-10-28T11:30:00Z")], AGORA)).toBe("nao_feito");
  });
  it("hoje com a hora já passada é não feito; com a hora por chegar é mais logo", () => {
    expect(estadoDaAgenda(hoje, [], AGORA)).toBe("nao_feito");
    expect(estadoDaAgenda({ ...hoje, hora: "17:30" }, [], AGORA)).toBe("mais_logo");
  });
  it("hoje sem hora fica para o fim do dia", () => {
    expect(estadoDaAgenda({ ...hoje, hora: null }, [], AGORA)).toBe("mais_logo");
  });
  it("dia anterior sem nada é não feito; dia seguinte é mais logo", () => {
    expect(estadoDaAgenda({ ...hoje, dia: "2026-10-28" }, [], AGORA)).toBe("nao_feito");
    expect(estadoDaAgenda({ ...hoje, dia: "2026-10-30" }, [], AGORA)).toBe("mais_logo");
  });
  it("usa o dia de Lisboa (evento às 23:30 UTC no verão é já o dia seguinte)", () => {
    const verao = { ...hoje, dia: "2026-07-02" };
    const e = conversa(1, "2026-07-01T23:30:00Z");
    expect(estadoDaAgenda(verao, [e], new Date("2026-07-03T10:00:00Z"))).toBe("feito");
  });
});

describe("atrasada e parada", () => {
  it("atrasada só se aberta e com próxima acção antes de hoje", () => {
    expect(atrasada(lead({ id: 1, proximaAcaoDia: "2026-10-28" }), "2026-10-29")).toBe(true);
    expect(atrasada(lead({ id: 1, proximaAcaoDia: "2026-10-29" }), "2026-10-29")).toBe(false);
    expect(atrasada(lead({ id: 1, proximaAcaoDia: "2026-10-28", estado: "won" }), "2026-10-29")).toBe(false);
    expect(atrasada(lead({ id: 1, proximaAcaoDia: null }), "2026-10-29")).toBe(false);
  });
  it("parada quando passa o prazo do passo", () => {
    expect(parada(lead({ id: 1, passo: "Contactado", passoDesde: new Date("2026-10-25T10:00:00Z") }), AGORA)).toBe(true);
    expect(parada(lead({ id: 1, passo: "Contactado", passoDesde: new Date("2026-10-27T10:00:00Z") }), AGORA)).toBe(false);
    expect(parada(lead({ id: 1, passo: "Passo novo", passoDesde: new Date("2026-01-01T00:00:00Z") }), AGORA)).toBe(false);
  });
});

describe("calcularAlertas", () => {
  it("lead nova sem contacto depois de 2 h", () => {
    const l = lead({ id: 1, passo: "Por contactar", criadaEm: new Date("2026-10-29T12:00:00Z") });
    const a = calcularAlertas({ leads: [l], eventos: [], agendaRecente: [], agora: AGORA });
    expect(a.map((x) => x.tipo)).toEqual(["nova_sem_contacto"]);
  });
  it("tentativas não chegam para tirar o alerta de lead nova; conversa ou email sim", () => {
    const l = lead({ id: 1, passo: "Por contactar", criadaEm: new Date("2026-10-29T12:00:00Z") });
    const comTentativa = calcularAlertas({ leads: [l], eventos: [tentativa(1, "2026-10-29T12:30:00Z")], agendaRecente: [], agora: AGORA });
    expect(comTentativa.some((x) => x.tipo === "nova_sem_contacto")).toBe(true);
    const comEmail = calcularAlertas({ leads: [l], eventos: [ev({ leadId: 1, tipo: "email", ocorreuEm: new Date("2026-10-29T12:30:00Z") })], agendaRecente: [], agora: AGORA });
    expect(comEmail).toEqual([]);
  });
  it("lead sem dono há mais de 24 h", () => {
    const l = lead({ id: 2, userId: null, criadaEm: new Date("2026-10-27T10:00:00Z"), passoDesde: new Date("2026-10-28T10:00:00Z") });
    const a = calcularAlertas({ leads: [l], eventos: [], agendaRecente: [], agora: AGORA });
    expect(a.map((x) => x.tipo)).toEqual(["por_designar"]);
  });
  it("simulação sem conversa há mais de 5 dias", () => {
    const l = lead({ id: 3, passo: "Simulação enviada", passoDesde: new Date("2026-10-20T10:00:00Z") });
    const sem = calcularAlertas({ leads: [l], eventos: [conversa(3, "2026-10-21T10:00:00Z")], agendaRecente: [], agora: AGORA });
    expect(sem.map((x) => x.tipo)).toEqual(["simulacao_sem_seguimento"]);
    const com = calcularAlertas({ leads: [l], eventos: [conversa(3, "2026-10-27T10:00:00Z")], agendaRecente: [], agora: AGORA });
    expect(com).toEqual([]);
  });
  it("não ata nem desata há mais de 30 dias", () => {
    const l = lead({ id: 4, passo: "Não ata nem desata", passoDesde: new Date("2026-09-01T10:00:00Z") });
    const a = calcularAlertas({ leads: [l], eventos: [], agendaRecente: [], agora: AGORA });
    expect(a.map((x) => x.tipo)).toEqual(["nao_ata"]);
  });
  it("5 tentativas seguidas depois da última conversa", () => {
    const l = lead({ id: 5, passoDesde: new Date("2026-10-28T10:00:00Z") });
    const evs = [
      conversa(5, "2026-10-20T10:00:00Z"),
      ...["21", "22", "23", "26", "27"].map((d) => tentativa(5, `2026-10-${d}T10:00:00Z`)),
    ];
    expect(calcularAlertas({ leads: [l], eventos: evs, agendaRecente: [], agora: AGORA }).map((x) => x.tipo)).toEqual(["tentativas"]);
    // Uma conversa no fim zera a contagem.
    const evs2 = [...evs, conversa(5, "2026-10-28T10:00:00Z")];
    expect(calcularAlertas({ leads: [l], eventos: evs2, agendaRecente: [], agora: AGORA })).toEqual([]);
  });
  it("acção falhada vem da agenda, só para leads abertas", () => {
    const aberta = lead({ id: 6, passoDesde: new Date("2026-10-28T10:00:00Z") });
    const ganha = lead({ id: 7, estado: "won", passoDesde: new Date("2026-10-28T10:00:00Z") });
    const agenda: AgendaR[] = [
      { dia: "2026-10-28", leadId: 6, userId: 9, hora: "10:00", passo: "Contactado" },
      { dia: "2026-10-28", leadId: 7, userId: 9, hora: null, passo: "Contactado" },
    ];
    const a = calcularAlertas({ leads: [aberta, ganha], eventos: [], agendaRecente: agenda, agora: AGORA });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: "acao_falhada", leadId: 6, userId: 9, desde: "2026-10-28 10:00" });
  });
  it("ordena por gravidade e ignora leads fechadas", () => {
    const leads = [
      lead({ id: 10, passo: "Não ata nem desata", passoDesde: new Date("2026-09-01T10:00:00Z") }),
      lead({ id: 11, passo: "Por contactar", criadaEm: new Date("2026-10-29T10:00:00Z") }),
      lead({ id: 12, passo: "Por contactar", estado: "lost", criadaEm: new Date("2026-10-29T10:00:00Z") }),
    ];
    const a = calcularAlertas({ leads, eventos: [], agendaRecente: [], agora: AGORA });
    expect(a.map((x) => x.leadId)).toEqual([11, 10]);
  });
});

describe("calcularResumo", () => {
  const cats = new Map<string, string | null>([["Preço", "Motivo Perdido"]]);

  it("conta novas, contacto no prazo, vendas, perdidas e previsto vs feito", () => {
    const leads = [
      // Nova, contactada em 1 h.
      lead({ id: 1, passo: "Por contactar", criadaEm: new Date("2026-10-27T09:00:00Z"), userId: 1 }),
      // Nova, contactada só ao fim de 3 h.
      lead({ id: 2, passo: "Por contactar", criadaEm: new Date("2026-10-27T09:00:00Z"), userId: 2 }),
      // Ganha no período.
      lead({ id: 3, estado: "won", valor: 300.5, userId: 1, origem: "Site", fechadaEm: new Date("2026-10-28T10:00:00Z") }),
      // Perdida no período, com motivo.
      lead({ id: 4, estado: "lost", tags: ["Preço"], userId: 2, origem: "Site", fechadaEm: new Date("2026-10-28T10:00:00Z") }),
      // Atrasada.
      lead({ id: 5, userId: 2, proximaAcaoDia: "2026-10-27" }),
    ];
    const eventos = [
      conversa(1, "2026-10-27T10:00:00Z"),
      ev({ leadId: 2, tipo: "chamada", duracaoSeg: 60, userId: 2, ocorreuEm: new Date("2026-10-27T12:00:00Z") }),
      tentativa(5, "2026-10-28T10:00:00Z"),
      ev({ leadId: 1, tipo: "passo", valor: "Simulação enviada", ocorreuEm: new Date("2026-10-28T09:00:00Z") }),
    ];
    const agenda: AgendaR[] = [
      { dia: "2026-10-28", leadId: 1, userId: 1, hora: "09:00", passo: "Contactado" },
      { dia: "2026-10-28", leadId: 5, userId: 2, hora: "10:00", passo: "Contactado" },
      { dia: "2026-10-28", leadId: 2, userId: 2, hora: "11:00", passo: "Contactado" },
    ];
    const r = calcularResumo({ de: "2026-10-26", ate: "2026-10-30", leads, eventos, agenda, categoriaDe: cats, agora: AGORA });

    expect(r.leadsNovas).toBe(2);
    expect(r.primeiroContacto).toEqual({ noPrazo: 1, avaliadas: 2 });
    expect(r.simulacoes).toBe(1);
    expect(r.vendas).toBe(1);
    expect(r.premio).toBe(300.5);
    expect(r.perdidas).toBe(1);
    expect(r.motivosPerda).toEqual([{ motivo: "Preço", n: 1 }]);
    expect(r.origens).toEqual([{ origem: "Site", fechadas: 2, ganhas: 1 }]);
    expect(r.atrasadas).toBe(1);
    expect(r.previsto).toBe(3);
    expect(r.feito).toBe(1);

    const p2 = r.pessoas.find((p) => p.userId === 2);
    expect(p2).toMatchObject({ previsto: 2, feito: 0, tentou: 1, naoFeito: 1, atrasadas: 1 });

    // Só dias úteis, e sexta 30 ainda é futuro.
    expect(r.dias.map((d) => d.dia)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(r.dias.find((d) => d.dia === "2026-10-28")).toMatchObject({ previsto: 3, feito: 1, futuro: false });
    expect(r.dias.find((d) => d.dia === "2026-10-30")?.futuro).toBe(true);

    expect(r.funil.map((f) => f.passo)).toEqual(["Por contactar", "Contactado"]);
  });

  it("período sem dados devolve zeros, sem rebentar", () => {
    const r = calcularResumo({ de: "2026-10-31", ate: "2026-11-01", leads: [], eventos: [], agenda: [], categoriaDe: cats, agora: AGORA });
    expect(r.leadsNovas).toBe(0);
    expect(r.dias).toEqual([]);
    expect(r.pessoas).toEqual([]);
  });
});

describe("agendaComEstado", () => {
  it("junta o estado a cada linha", () => {
    const ag = agendaComEstado(
      [{ dia: "2026-10-29", leadId: 1, userId: 1, hora: null, passo: null }],
      [conversa(1, "2026-10-29T09:00:00Z")],
      AGORA,
    );
    expect(ag[0].estado).toBe("feito");
  });
});
