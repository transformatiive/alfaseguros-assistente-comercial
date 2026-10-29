import { describe, it, expect } from "vitest";
import {
  DEPARTAMENTO_360,
  clienteEscreveuDepoisDeFechar,
  deOutroDepartamento,
  escolherTicketDoCliente,
  idadeEmHoras,
  RISCO_THRESHOLD_HOURS,
  telefoneDoTicket,
  urlDoDesk,
} from "./tickets-risco.js";

describe("idadeEmHoras", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("rounds down — 23h59m is 23 hours, not 24", () => {
    expect(idadeEmHoras(new Date("2026-08-27T12:01:00Z"), now)).toBe(23);
  });

  it("counts a ticket opened exactly 24 hours ago as 24", () => {
    expect(idadeEmHoras(new Date("2026-08-27T12:00:00Z"), now)).toBe(24);
  });

  it("counts long-open tickets in whole hours", () => {
    expect(idadeEmHoras(new Date("2026-08-25T12:00:00Z"), now)).toBe(72);
  });

  it("is zero for a ticket opened this minute", () => {
    expect(idadeEmHoras(now, now)).toBe(0);
  });

  it("holds across a Lisbon DST change, because it works in absolute time", () => {
    // 2026-10-25 02:00 UTC is the autumn change in Europe/Lisbon. 24 absolute
    // hours is 24 hours whatever the wall clock did.
    const after = new Date("2026-10-25T12:00:00Z");
    expect(idadeEmHoras(new Date("2026-10-24T12:00:00Z"), after)).toBe(24);
  });
});

describe("RISCO_THRESHOLD_HOURS", () => {
  it("is the 24-hour SLA the follow-up payload also reports", () => {
    expect(RISCO_THRESHOLD_HOURS).toBe(24);
  });
});

describe("urlDoDesk", () => {
  it("dá o link da consola de agente, como a equipa o copia do browser", () => {
    // O exemplo do Nuno, a 20/10/2026, para o ticket #172694.
    expect(urlDoDesk("367662000127190248", { departmentId: "367662000000006907" })).toBe(
      "https://desk.zoho.com/agent/alfaseguros/alfa-seguros/tickets/details/367662000127190248",
    );
  });

  it("usa o departamento do ticket", () => {
    expect(urlDoDesk("1", { departmentId: "367662000097048676" })).toContain("/alfaseguros/corporate/");
  });

  it("sem departamento conhecido, usa Alfa Seguros", () => {
    expect(urlDoDesk("1")).toContain("/alfaseguros/alfa-seguros/tickets/details/1");
    expect(urlDoDesk("1", { departmentId: "999" })).toContain("/alfa-seguros/");
  });

  it("não usa o link antigo do portal, nem o id numérico da organização", () => {
    const raw = { webUrl: "https://desk.zoho.com/support/alfaseguros/ShowHomePage.do#Cases/dv/1" };
    expect(urlDoDesk("1", raw)).not.toContain("ShowHomePage");
    expect(urlDoDesk("1", null)).not.toContain("/agent/683863304/");
  });
});

describe("escolherTicketDoCliente", () => {
  const c = (id: string, fechado: boolean, criadoEm: number, fechadoEm = criadoEm) => ({
    id,
    numero: id.replace("T", "18"),
    fp: "912345678",
    url: `https://desk/${id}`,
    fechado,
    criadoEm,
    fechadoEm,
  });

  it("prefere o ticket aberto mais recente, mesmo havendo fechados mais novos", () => {
    const m = escolherTicketDoCliente([c("T1", false, 1), c("T2", false, 5), c("T3", true, 9, 10)]);
    expect(m.get("912345678")).toMatchObject({ id: "T2", fechado: false });
  });

  it("sem aberto, escolhe o que fechou por último", () => {
    const m = escolherTicketDoCliente([c("T1", true, 1, 20), c("T2", true, 5, 6)]);
    expect(m.get("912345678")).toMatchObject({ id: "T1", fechado: true });
  });

  it("ignora tickets sem número ou sem telefone", () => {
    const m = escolherTicketDoCliente([
      { ...c("T1", false, 1), numero: null },
      { ...c("T2", false, 2), fp: null },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("deOutroDepartamento", () => {
  it("a Corporate e a Contratação Pública ficam de fora do painel 360", () => {
    expect(deOutroDepartamento({ departmentId: "367662000097048676" })).toBe(true);
    expect(deOutroDepartamento({ departmentId: "367662000128357813" })).toBe(true);
  });

  it("Alfa Seguros, ou sem departamento conhecido, fica", () => {
    expect(deOutroDepartamento({ departmentId: DEPARTAMENTO_360 })).toBe(false);
    expect(deOutroDepartamento({})).toBe(false);
    expect(deOutroDepartamento(null)).toBe(false);
  });
});

describe("telefoneDoTicket", () => {
  it("lê o campo Telefone do ticket em qualquer formato", () => {
    expect(telefoneDoTicket({ phone: "+351 939 148 441" })).toBe("939148441");
    expect(telefoneDoTicket({ phone: "939148441" })).toBe("939148441");
  });

  it("sem número válido, nada", () => {
    expect(telefoneDoTicket({ phone: "123" })).toBeNull();
    expect(telefoneDoTicket({ phone: null })).toBeNull();
    expect(telefoneDoTicket(undefined)).toBeNull();
  });
});

describe("clienteEscreveuDepoisDeFechar", () => {
  const fechou = new Date("2026-10-10T10:00:00Z");
  const msg = (iso: string, autorTipo: string, direcao: string | null, texto = "Podem enviar-me a apólice?") => ({
    quando: new Date(iso),
    autorTipo,
    direcao,
    texto,
  });

  it("o cliente escreveu depois do fecho e ninguém respondeu: volta ao painel", () => {
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [
        msg("2026-10-09T10:00:00Z", "AGENT", "out"),
        msg("2026-10-12T09:00:00Z", "END_USER", "in"),
      ])?.toISOString(),
    ).toBe("2026-10-12T09:00:00.000Z");
  });

  it("respondemos depois da mensagem do cliente: nada a fazer", () => {
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [
        msg("2026-10-12T09:00:00Z", "END_USER", "in"),
        msg("2026-10-12T15:00:00Z", "AGENT", "out"),
      ]),
    ).toBeNull();
  });

  it("um email que entrou atribuído a um agente não é resposta nossa", () => {
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [
        msg("2026-10-12T09:00:00Z", "END_USER", "in"),
        msg("2026-10-12T15:00:00Z", "AGENT", "in"),
      ])?.toISOString(),
    ).toBe("2026-10-12T09:00:00.000Z");
  });

  it("mensagens do cliente antes do fecho não contam", () => {
    expect(clienteEscreveuDepoisDeFechar(fechou, [msg("2026-10-09T09:00:00Z", "END_USER", "in")])).toBeNull();
  });

  it("respostas automáticas e agradecimentos não trazem o ticket de volta", () => {
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [msg("2026-10-10T10:00:30Z", "END_USER", "in")]),
    ).toBeNull();
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [
        msg("2026-10-12T09:00:00Z", "END_USER", "in", "Resposta automática: estou fora do escritório até dia 20."),
      ]),
    ).toBeNull();
    expect(
      clienteEscreveuDepoisDeFechar(fechou, [msg("2026-10-12T09:00:00Z", "END_USER", "in", "Muito obrigado, recebi.")]),
    ).toBeNull();
  });

  it("sem mensagens, nada", () => {
    expect(clienteEscreveuDepoisDeFechar(fechou, [])).toBeNull();
  });
});
