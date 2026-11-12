import { describe, expect, it } from "vitest";
import {
  classificarSimulacao,
  contactoMarcado,
  horasSemFimDeSemana,
  horasUteis,
  juntarCaixas,
  lerProximoContacto,
  montarCaixas,
  rgpdEmFalta,
  type ChamadaParaCaixa,
  type ConversaParaCaixa,
  type TicketParaCaixa,
} from "./caixas.js";

const T = (o: Partial<TicketParaCaixa> = {}): TicketParaCaixa => ({
  id: "t1",
  ticketNumber: "187301",
  subject: "Simulação MR",
  status: "Aberto",
  statusType: "Open",
  createdTime: new Date("2026-11-09T10:00:00Z"),
  modifiedTime: new Date("2026-11-10T10:00:00Z"),
  closedTime: null,
  contactName: "Ivone",
  contactPhone: "961145555",
  phoneFingerprint: "961145555",
  telefoneTicket: null,
  assigneeId: "z1",
  assigneeName: "Tiago Paiva",
  deskUrl: "https://desk/t1",
  negocio: "Simulação",
  tipoPedido: null,
  estadoNegocio: null,
  rgpd: null,
  passoAutomatico: null,
  ...o,
});

const C = (o: Omit<Partial<ConversaParaCaixa>, "quando"> & { quando: string }): ConversaParaCaixa => ({
  ticketId: "t1",
  tipo: "thread",
  direcao: "out",
  autorTipo: "AGENT",
  temAnexo: false,
  texto: "",
  ...o,
  quando: new Date(o.quando),
});

const ch = (inicio: string, duracaoS = 120, fingerprint = "961145555"): ChamadaParaCaixa => ({
  fingerprint,
  inicio: new Date(inicio),
  atendida: true,
  duracaoS,
});

// Quinta-feira, 12/11/2026, 15:00 em Lisboa (UTC+0 em novembro).
const AGORA = new Date("2026-11-12T15:00:00Z");

describe("horas", () => {
  it("horas úteis contam só 09h-19h de segunda a sexta", () => {
    // sexta 17:00 → segunda 10:00 = 2 h (sexta) + 1 h (segunda)
    expect(horasUteis(new Date("2026-11-13T17:00:00Z"), new Date("2026-11-16T10:00:00Z"))).toBe(3);
  });
  it("sem fins de semana: sexta 12h → segunda 12h são 24 h", () => {
    expect(horasSemFimDeSemana(new Date("2026-11-13T12:00:00Z"), new Date("2026-11-16T12:00:00Z"))).toBe(24);
  });
  it("respeita a hora de verão de Lisboa", () => {
    // 1 de julho: 09h Lisboa = 08h UTC
    expect(horasUteis(new Date("2026-07-01T07:00:00Z"), new Date("2026-07-01T09:00:00Z"))).toBe(1);
  });
});

describe("simulações", () => {
  it("por enviar: o cliente mandou dados e não saiu simulação; vermelho ao fim de 24 h", () => {
    const r = classificarSimulacao(
      T(),
      [C({ quando: "2026-11-10T09:00:00Z", direcao: "in", autorTipo: "END_USER" })],
      [],
      AGORA,
    );
    expect(r.caixa).toBe("por_enviar");
    if (r.caixa !== "por_enviar") return;
    expect(r.linha.desde).toBe("2026-11-10T09:00:00.000Z");
    expect(r.linha.vermelha).toBe(true);
  });

  it("por enviar ainda não está vermelha com menos de 24 h", () => {
    const r = classificarSimulacao(
      T(),
      [C({ quando: "2026-11-12T09:00:00Z", direcao: "in", autorTipo: "END_USER" })],
      [],
      AGORA,
    );
    expect(r.caixa === "por_enviar" && r.linha.vermelha).toBe(false);
  });

  it("à espera do cliente não está por enviar", () => {
    expect(classificarSimulacao(T({ status: "Espera Cliente", statusType: "On Hold" }), [], [], AGORA).caixa).toBeNull();
  });

  it("email nosso com anexo = enviada; sem conversa depois → sem seguimento, vermelho ao fim de 2 h úteis", () => {
    const r = classificarSimulacao(
      T(),
      [
        C({ quando: "2026-11-10T09:00:00Z", direcao: "in", autorTipo: "END_USER" }),
        C({ quando: "2026-11-10T14:26:00Z", temAnexo: true }),
        C({ quando: "2026-11-12T10:00:00Z", temAnexo: false, texto: "Já teve oportunidade de ver?" }),
      ],
      [],
      AGORA,
    );
    expect(r.caixa).toBe("sem_seguimento");
    if (r.caixa !== "sem_seguimento") return;
    expect(r.linha.desde).toBe("2026-11-10T14:26:00.000Z");
    expect(r.linha.vermelha).toBe(true);
  });

  it("uma chamada atendida depois do envio tira-a da caixa", () => {
    const r = classificarSimulacao(
      T(),
      [C({ quando: "2026-11-10T14:26:00Z", temAnexo: true })],
      [ch("2026-11-11T10:00:00Z")],
      AGORA,
    );
    expect(r.caixa).toBeNull();
  });

  it("chamada curta (menos de 20 s) ou antes do envio não conta", () => {
    const r = classificarSimulacao(
      T(),
      [C({ quando: "2026-11-10T14:26:00Z", temAnexo: true })],
      [ch("2026-11-11T10:00:00Z", 10), ch("2026-11-10T10:00:00Z")],
      AGORA,
    );
    expect(r.caixa).toBe("sem_seguimento");
  });

  it("a chamada pode vir do número escrito no ticket", () => {
    const r = classificarSimulacao(
      T({ telefoneTicket: "912345678" }),
      [C({ quando: "2026-11-10T14:26:00Z", temAnexo: true })],
      [ch("2026-11-11T10:00:00Z", 60, "912345678")],
      AGORA,
    );
    expect(r.caixa).toBeNull();
  });

  it("resposta do cliente depois do envio tira-a da caixa", () => {
    const r = classificarSimulacao(
      T(),
      [
        C({ quando: "2026-11-10T14:26:00Z", temAnexo: true }),
        C({ quando: "2026-11-11T09:00:00Z", direcao: "in", autorTipo: "END_USER" }),
      ],
      [],
      AGORA,
    );
    expect(r.caixa).toBeNull();
  });

  it("estado Espera Follow Up sem anexo conta como enviada, à hora do último email nosso", () => {
    const r = classificarSimulacao(
      T({ status: "Espera Follow Up", statusType: "On Hold" }),
      [C({ quando: "2026-11-12T14:30:00Z" })],
      [],
      AGORA,
    );
    expect(r.caixa).toBe("sem_seguimento");
    if (r.caixa !== "sem_seguimento") return;
    expect(r.linha.vermelha).toBe(false);
  });

  it("conversas antigas sem informação de anexo: vale o texto do email", () => {
    const r = classificarSimulacao(
      T(),
      [C({ quando: "2026-11-10T14:26:00Z", temAnexo: undefined, texto: "Conforme solicitado, fizemos simulações de seguro" })],
      [],
      AGORA,
    );
    expect(r.caixa).toBe("sem_seguimento");
  });

  it("negócio ganho, ticket fechado ou sem simulação ficam fora", () => {
    expect(classificarSimulacao(T({ estadoNegocio: "GANHO" }), [], [], AGORA).caixa).toBeNull();
    expect(classificarSimulacao(T({ statusType: "Closed" }), [], [], AGORA).caixa).toBeNull();
    expect(classificarSimulacao(T({ negocio: "Revisão de Contrato" }), [], [], AGORA).caixa).toBeNull();
    expect(classificarSimulacao(T({ negocio: null, tipoPedido: "SIMULAÇÃO" }), [], [], AGORA).caixa).toBe("por_enviar");
  });
});

describe("RGPD em falta", () => {
  it("ticket fechado com RGPD Solicitado entra", () => {
    const r = rgpdEmFalta(T({ statusType: "Closed", rgpd: "Solicitado", closedTime: new Date("2026-11-05T10:00:00Z") }));
    expect(r?.desde).toBe("2026-11-05T10:00:00.000Z");
  });
  it("Angariado, aberto ou apagado não entram", () => {
    expect(rgpdEmFalta(T({ statusType: "Closed", rgpd: "Angariado" }))).toBeNull();
    expect(rgpdEmFalta(T({ statusType: "Open", rgpd: "Solicitado" }))).toBeNull();
    expect(rgpdEmFalta(T({ statusType: "Deleted", rgpd: "Solicitado" }))).toBeNull();
  });
});

describe("próximo contacto nos comentários", () => {
  const quarta = new Date("2026-11-11T16:00:00Z");
  it("lê data e hora", () => {
    const r = lerProximoContacto("Cliente pediu para ligar dia 13/11 às 10h30", quarta);
    expect(r?.quando.toISOString()).toBe("2026-11-13T10:30:00.000Z");
    expect(r?.comHora).toBe(true);
  });
  it("lê 'próximo contacto: amanhã 15h'", () => {
    const r = lerProximoContacto("Próximo contacto: amanhã 15h", quarta);
    expect(r?.quando.toISOString()).toBe("2026-11-12T15:00:00.000Z");
  });
  it("lê o dia da semana sem hora (fim do dia)", () => {
    const r = lerProximoContacto("Recontactar na sexta-feira", quarta);
    expect(r?.quando.toISOString()).toBe("2026-11-13T18:00:00.000Z");
    expect(r?.comHora).toBe(false);
  });
  it("uma data de débito não é um contacto (caso #186802)", () => {
    expect(
      lerProximoContacto(
        "Teresa Pereira, liga para saber se é possivel alterar a data de débito que tem débito agendado para 23/11 e queria alterar pedido para dia 27/11. Fico de validar com TRQ e dar feedback.",
        quarta,
      ),
    ).toBeNull();
  });
  it("sem palavra de contacto não lê datas", () => {
    expect(lerProximoContacto("Apólice começa a 01/12", quarta)).toBeNull();
  });

  it("linha atrasada até haver chamada atendida ou email nosso", () => {
    const conv = [C({ tipo: "comment", direcao: null, quando: "2026-11-11T16:00:00Z", texto: "Ligar amanhã às 10h" })];
    const atrasada = contactoMarcado(T(), conv, [], AGORA);
    expect(atrasada?.vermelha).toBe(true);
    expect(contactoMarcado(T(), conv, [ch("2026-11-12T10:05:00Z")], AGORA)).toBeNull();
    expect(
      contactoMarcado(T(), [...conv, C({ quando: "2026-11-12T11:00:00Z" })], [], AGORA),
    ).toBeNull();
  });

  it("data futura fica marcada, não atrasada", () => {
    const conv = [C({ tipo: "comment", direcao: null, quando: "2026-11-12T09:00:00Z", texto: "Próximo contacto 20/11 às 11h" })];
    const r = contactoMarcado(T(), conv, [], AGORA);
    expect(r?.vermelha).toBe(false);
    expect(r?.desde).toBe("2026-11-20T11:00:00.000Z");
  });
});

describe("montar e juntar", () => {
  it("um ticket cai numa só caixa de simulações, e a equipa soma as pessoas", () => {
    const c1 = montarCaixas({
      tickets: [T()],
      conversas: [C({ quando: "2026-11-10T14:26:00Z", temAnexo: true })],
      chamadas: [],
      now: AGORA,
    });
    expect(c1.simulacoesPorEnviar.total).toBe(0);
    expect(c1.simulacoesSemSeguimento.total).toBe(1);
    const c2 = montarCaixas({ tickets: [T({ id: "t2" })], conversas: [], chamadas: [], now: AGORA });
    const eq = juntarCaixas([c1, c2]);
    expect(eq.simulacoesPorEnviar.total).toBe(1);
    expect(eq.simulacoesSemSeguimento.vermelhas).toBe(1);
  });
});
