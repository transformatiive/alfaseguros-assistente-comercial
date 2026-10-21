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

  it("um ticket do dia anterior à chamada não conta", () => {
    const fp = "911111111";
    const ctx = lerContexto(
      { linkedTicketId: null, descricao: "Ligar.", fingerprint: fp, chamadaEm: "2026-09-03T09:00:00.000Z" },
      [ticket({ id: "ontem", statusType: "Closed", phoneFingerprint: fp, createdTime: "2026-09-02T22:00:00.000Z" })],
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
