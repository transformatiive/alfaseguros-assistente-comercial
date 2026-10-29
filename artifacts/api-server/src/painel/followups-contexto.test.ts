import { describe, expect, it } from "vitest";
import {
  descreverFecho,
  eDeQuem,
  estadoDoNegocio,
  inicioDaChamada,
  negocioDecidido,
  nomeDoNegocio,
  lerContexto,
  numerosCitados,
  type TicketDeContexto,
} from "./followups-contexto.js";

const TIAGO = "367662000067262023";
const VANIA = "367662000022555001";

function ticket(p: Partial<TicketDeContexto> & { id: string }): TicketDeContexto {
  return {
    ticketNumber: null,
    statusType: "Open",
    assigneeId: TIAGO,
    phoneFingerprint: null,
    createdTime: null,
    closedTime: null,
    ...p,
  };
}

describe("numerosCitados", () => {
  it("lê o número como a análise o escreve", () => {
    expect(numerosCitados("evitar que o pedido de cotação #173005 fique parado")).toEqual(["173005"]);
    expect(numerosCitados("ver ticket 173005 e o #173701")).toEqual(["173005", "173701"]);
  });

  it("não confunde um telefone ou um valor com um ticket", () => {
    expect(numerosCitados("ligar para 938840630 sobre 250 euros")).toEqual([]);
  });
});

/**
 * Casos reais de Outubro de 2026, lidos no Desk.
 */
describe("lerContexto", () => {
  it("#173005: o ticket citado no texto está fechado, a promessa sai", () => {
    const fechado = ticket({
      id: "367662000127411347",
      ticketNumber: "173005",
      statusType: "Closed",
      phoneFingerprint: null, // o ticket veio por email, sem telefone
      createdTime: "2026-09-03T15:54:41.000Z",
      closedTime: "2026-09-08T11:15:34.000Z",
    });
    const ctx = lerContexto(
      {
        linkedTicketId: null,
        descricao: "Confirmar ... evitar que o pedido de cotação #173005 fique parado.",
        fingerprint: "938840630",
        chamadaEm: "2026-09-03T15:27:00.000Z",
      },
      [fechado],
    );
    expect(ctx.principal?.ticketNumber).toBe("173005");
    expect(ctx.fechadoPor?.id).toBe(fechado.id);
    expect(ctx.dono).toBeNull();
  });

  it("Geral Adgestana: os tickets do dia da chamada estão todos fechados, a promessa sai", () => {
    const fp = "912421471";
    const tickets = [
      ticket({ id: "a", ticketNumber: "172947", statusType: "Closed", phoneFingerprint: fp,
        createdTime: "2026-09-03T14:09:37.000Z", closedTime: "2026-09-03T14:12:04.000Z" }),
      ticket({ id: "b", ticketNumber: "172962", statusType: "Closed", phoneFingerprint: fp, assigneeId: VANIA,
        createdTime: "2026-09-03T14:34:25.000Z", closedTime: "2026-09-03T16:59:19.000Z" }),
      // De Junho: fora da janela, não pode contar nem para um lado nem para o outro.
      ticket({ id: "c", ticketNumber: "151407", statusType: "Open", phoneFingerprint: fp,
        createdTime: "2026-06-03T09:47:02.000Z" }),
    ];
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "A Vânia deve contactar novamente o cliente.", fingerprint: fp,
        chamadaEm: "2026-09-03T14:05:00.000Z" },
      tickets,
    );
    expect(ctx.relacionados.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(ctx.fechadoPor?.ticketNumber).toBe("172962");
  });

  it("um ticket ainda aberto chega para a promessa continuar, e diz de quem é", () => {
    const fp = "912421471";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar proposta.", fingerprint: fp,
        chamadaEm: "2026-09-03T14:05:00.000Z" },
      [
        ticket({ id: "a", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-09-03T14:09:37.000Z" }),
        ticket({ id: "b", statusType: "Open", phoneFingerprint: fp, assigneeId: VANIA,
          createdTime: "2026-09-05T10:00:00.000Z" }),
      ],
    );
    expect(ctx.fechadoPor).toBeNull();
    expect(ctx.dono).toBe(VANIA);
    expect(ctx.principal?.id).toBe("b");
  });

  it("sem tickets, nada fecha: um desconhecido não tira a promessa da lista", () => {
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: "911111111", chamadaEm: "2026-09-03T14:05:00.000Z" },
      [],
    );
    expect(ctx.fechadoPor).toBeNull();
    expect(ctx.principal).toBeNull();
  });

  it("o ticket ligado pelos casos ganha a qualquer outro", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: "ligado", descricao: "Ligar.", fingerprint: fp, chamadaEm: "2026-09-03T14:05:00.000Z" },
      [
        ticket({ id: "outro", phoneFingerprint: fp, createdTime: "2026-09-04T10:00:00.000Z" }),
        ticket({ id: "ligado", phoneFingerprint: fp, createdTime: "2026-09-03T14:10:00.000Z" }),
      ],
    );
    expect(ctx.principal?.id).toBe("ligado");
  });

  it("um ticket de antes da chamada que já estava fechado não conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [
        ticket({ id: "ontem", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-09-02T22:00:00.000Z",
          closedTime: "2026-09-02T23:00:00.000Z" }),
        // Fechado sem data: não se pode provar que fechou depois da chamada.
        ticket({ id: "sem-data", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-09-01T10:00:00.000Z" }),
      ],
    );
    expect(ctx.relacionados).toEqual([]);
  });
});

/**
 * Os casos que o Tiago marcou no PDF "Assist Virtual 28/10": promessas que o
 * painel dava em atraso com o ticket do cliente já tratado no Desk.
 */
describe("lerContexto: tickets abertos antes da chamada (Tiago, 28/10)", () => {
  it("#166416: aberto a 06/08, chamada a 03/09, fechado depois da chamada; a promessa sai", () => {
    // O contacto é o parceiro (915769762); o número do cliente está no campo
    // Telefone do ticket, quando o formulário o preencheu.
    const fp = "211219354";
    const t = ticket({ id: "166416", ticketNumber: "166416", statusType: "Closed", phoneFingerprint: "915769762",
      telefoneDoTicket: fp,
      createdTime: "2026-08-06T12:43:00.000Z", closedTime: "2026-09-03T11:26:00.000Z" });
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Contactar António até ao final da semana.", fingerprint: fp,
        zidDoAgente: TIAGO, chamadaEm: "2026-09-03T10:45:00.000Z" },
      [t],
    );
    expect(ctx.principal?.ticketNumber).toBe("166416");
    expect(ctx.fechadoPor?.ticketNumber).toBe("166416");
  });

  it("#177770: aberto antes da chamada e ainda em espera; a promessa fica e o ticket é o da prova", () => {
    const fp = "964016910";
    const t = ticket({ id: "177770", ticketNumber: "177770", statusType: "On Hold", phoneFingerprint: fp,
      createdTime: "2026-09-23T14:04:00.000Z" });
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar simulação de saúde.", fingerprint: fp,
        zidDoAgente: TIAGO, chamadaEm: "2026-09-24T12:28:00.000Z" },
      [t],
    );
    expect(ctx.fechadoPor).toBeNull();
    expect(ctx.principal?.id).toBe("177770");
    // De quem fez a chamada: um ticket anterior não muda a promessa de painel.
    expect(ctx.dono).toBeNull();
  });

  it("ticket de formulário com o telefone do parceiro: liga pelo campo Telefone do ticket", () => {
    const t = ticket({ id: "173882", ticketNumber: "173882", statusType: "Closed", phoneFingerprint: "915769762",
      telefoneDoTicket: "939148441", createdTime: "2026-09-07T16:50:00.000Z", closedTime: "2026-09-10T16:33:00.000Z" });
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar simulação auto.", fingerprint: "939148441",
        zidDoAgente: TIAGO, chamadaEm: "2026-09-08T13:34:00.000Z" },
      [t],
    );
    expect(ctx.fechadoPor?.ticketNumber).toBe("173882");
  });

  it("ticket sem o telefone do cliente: liga pelo email", () => {
    const t = ticket({ id: "177438", ticketNumber: "177438", statusType: "Closed", phoneFingerprint: null,
      email: "cliente@example.com", createdTime: "2026-09-22T15:42:00.000Z", closedTime: "2026-10-21T10:37:00.000Z" });
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar simulação multirriscos.", fingerprint: "964234472",
        zidDoAgente: TIAGO, chamadaEm: "2026-09-24T10:29:00.000Z", emails: new Set(["cliente@example.com"]) },
      [t],
    );
    expect(ctx.fechadoPor?.ticketNumber).toBe("177438");
  });

  it("dois tickets anteriores do mesmo contacto: é ambíguo e nenhum conta", () => {
    // O #172398 e o #172399 vieram do mesmo parceiro, para clientes diferentes.
    const fp = "939083215";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar o email com o pedido de dados.", fingerprint: fp,
        zidDoAgente: TIAGO, chamadaEm: "2026-09-03T08:22:00.000Z" },
      [
        ticket({ id: "172398", ticketNumber: "172398", statusType: "Closed", phoneFingerprint: fp,
          createdTime: "2026-09-01T17:31:00.000Z", closedTime: "2026-09-16T14:53:00.000Z" }),
        ticket({ id: "172399", ticketNumber: "172399", statusType: "On Hold", phoneFingerprint: fp,
          createdTime: "2026-09-01T17:37:00.000Z" }),
      ],
    );
    expect(ctx.fechadoPor).toBeNull();
    expect(ctx.relacionados).toEqual([]);
  });

  it("um ticket anterior de outro agente não conta: pode ser outro assunto", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Enviar simulação de saúde.", fingerprint: fp,
        zidDoAgente: TIAGO, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "renovacao", statusType: "Closed", assigneeId: VANIA, phoneFingerprint: fp,
        createdTime: "2026-08-20T09:00:00.000Z", closedTime: "2026-09-04T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
    expect(ctx.fechadoPor).toBeNull();
    expect(ctx.principal).toBeNull();
  });

  it("sem saber quem fez a chamada, um ticket anterior não conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: null,
        chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "x", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-08-20T09:00:00.000Z",
        closedTime: "2026-09-04T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
  });

  it("um ticket anterior aberto não muda a promessa de painel", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: TIAGO,
        chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "x", statusType: "Open", phoneFingerprint: fp, createdTime: "2026-08-20T09:00:00.000Z" })],
    );
    expect(ctx.principal?.id).toBe("x");
    expect(ctx.dono).toBeNull();
  });

  it("um ticket do próprio dia, aberto e fechado antes da chamada, não conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: TIAGO,
        chamadaEm: "2026-09-03T14:00:00.000Z" },
      [ticket({ id: "manha", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-09-03T07:00:00.000Z",
        closedTime: "2026-09-03T07:30:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
  });

  it("o email não liga tickets de outro agente", () => {
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: "964234472", zidDoAgente: TIAGO,
        chamadaEm: "2026-09-24T10:29:00.000Z", emails: new Set(["partilhado@example.com"]) },
      [ticket({ id: "z", statusType: "Closed", assigneeId: VANIA, email: "partilhado@example.com",
        createdTime: "2026-09-26T10:00:00.000Z", closedTime: "2026-09-28T10:00:00.000Z" })],
    );
    expect(ctx.fechadoPor).toBeNull();
  });

  it("mais de 60 dias antes da chamada não conta, mesmo aberto", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: TIAGO, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "velho", statusType: "Open", phoneFingerprint: fp, createdTime: "2026-07-03T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
  });

  it("aberto antes da chamada com o negócio já decidido não conta: não se sabe quando decidiu", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: TIAGO, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "ganho", statusType: "Open", estadoNegocio: "GANHO", phoneFingerprint: fp,
        createdTime: "2026-08-20T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
    expect(ctx.fechadoPor).toBeNull();
  });

  it("apagado antes da chamada não conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, zidDoAgente: TIAGO, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "lixo", statusType: "Deleted", phoneFingerprint: fp, createdTime: "2026-08-20T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
  });

  it("sem hora da chamada, só o ticket ligado ou citado conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, chamadaEm: null },
      [ticket({ id: "x", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-08-20T09:00:00.000Z",
        closedTime: "2026-09-10T09:00:00.000Z" })],
    );
    expect(ctx.relacionados).toEqual([]);
  });
});

describe("eDeQuem", () => {
  const equipa = new Set([TIAGO, VANIA]);
  const tiago = { zid: TIAGO, ringoverUserId: "23265674" };
  const vania = { zid: VANIA, ringoverUserId: "11111111" };

  it("com ticket aberto de alguém da equipa, é dessa pessoa e não de quem atendeu", () => {
    const p = { dono: VANIA, agenteDaChamada: "23265674", zidsDaEquipa: equipa };
    expect(eDeQuem({ ...p, colaborador: tiago })).toBe(false);
    expect(eDeQuem({ ...p, colaborador: vania })).toBe(true);
  });

  it("sem ticket aberto, é de quem fez a chamada", () => {
    const p = { dono: null, agenteDaChamada: "23265674", zidsDaEquipa: equipa };
    expect(eDeQuem({ ...p, colaborador: tiago })).toBe(true);
    expect(eDeQuem({ ...p, colaborador: vania })).toBe(false);
  });

  it("um ticket atribuído a alguém de fora não a tira a toda a gente", () => {
    const p = { dono: "integracao", agenteDaChamada: "23265674", zidsDaEquipa: equipa };
    expect(eDeQuem({ ...p, colaborador: tiago })).toBe(true);
  });
});

describe("descreverFecho", () => {
  it("diz o número e o dia, em Lisboa", () => {
    expect(
      descreverFecho(ticket({ id: "x", ticketNumber: "173005", closedTime: "2026-09-08T11:15:34.000Z" })),
    ).toBe("ticket #173005 fechado a 08/09");
  });
});

describe("inicioDaChamada", () => {
  it("usa a primeira perna com hora", () => {
    expect(
      inicioDaChamada(
        [
          { startTime: "2026-09-03T15:30:00.000Z" },
          { startTime: "2026-09-03T15:27:00.000Z" },
          { startTime: null },
        ],
        "2026-09-03",
      ),
    ).toBe("2026-09-03T15:27:00.000Z");
  });

  it("sem pernas com hora, recua para o início do dia", () => {
    expect(inicioDaChamada([], "2026-09-03")).toBe("2026-09-02T23:00:00.000Z");
  });
});

describe("negócio decidido", () => {
  it("lê o Estado do Negócio dos campos do Desk", () => {
    expect(estadoDoNegocio({ cf_estado_do_negocio: "Ganho " })).toBe("GANHO");
    expect(estadoDoNegocio({ cf_estado_do_negocio: null })).toBeNull();
    expect(estadoDoNegocio(null)).toBeNull();
    expect(nomeDoNegocio({ cf_negocio: "SIMULAÇÃO", cf_negocio_1: "Revisão de Contrato" })).toBe(
      "Revisão de Contrato",
    );
  });

  it("GANHO, PERDIDO e TRATADO acabam o assunto; EM TRATAMENTO não", () => {
    expect(negocioDecidido("GANHO")).toBe(true);
    expect(negocioDecidido("PERDIDO")).toBe(true);
    expect(negocioDecidido("TRATADO")).toBe(true);
    expect(negocioDecidido("EM TRATAMENTO")).toBe(false);
    expect(negocioDecidido(null)).toBe(false);
  });

  it("um negócio GANHO num ticket ainda aberto tira a promessa, e diz porquê", () => {
    const ctx = lerContexto(
      { linkedTicketId: "t", descricao: "Enviar simulação.", fingerprint: null, chamadaEm: null },
      [ticket({ id: "t", ticketNumber: "178288", statusType: "Open", estadoNegocio: "GANHO" })],
    );
    expect(ctx.fechadoPor?.id).toBe("t");
    expect(ctx.dono).toBeNull();
    expect(descreverFecho(ctx.fechadoPor!)).toBe("negócio GANHO no ticket #178288");
  });
});

describe("ticket apagado no Desk", () => {
  it("conta como fechado e diz porquê", () => {
    const ctx = lerContexto(
      { linkedTicketId: "t", descricao: "Devolver chamada.", fingerprint: null, chamadaEm: null },
      [ticket({ id: "t", ticketNumber: "172698", statusType: "Deleted" })],
    );
    expect(ctx.fechadoPor?.id).toBe("t");
    expect(descreverFecho(ctx.fechadoPor!)).toBe("ticket #172698 apagado no Desk");
  });
});
