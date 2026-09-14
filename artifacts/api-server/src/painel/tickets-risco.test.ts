import { describe, it, expect } from "vitest";
import { idadeEmHoras, RISCO_THRESHOLD_HOURS, urlDoDesk } from "./tickets-risco.js";

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
  it("usa o link que o próprio Desk deu", () => {
    const raw = { webUrl: "https://desk.zoho.com/agent/alfaseguros/naovida/tickets/details/123" };
    expect(urlDoDesk("123", raw)).toBe(raw.webUrl);
  });

  it("recorre ao URL do portal quando o ticket foi sincronizado sem webUrl", () => {
    expect(urlDoDesk("123", { subject: "x" })).toBe(
      "https://desk.zoho.com/support/alfaseguros/ShowHomePage.do#Cases/dv/123",
    );
    expect(urlDoDesk("123")).toContain("/support/alfaseguros/");
  });

  it("nunca constrói o caminho com o id numérico da organização", () => {
    // Era esta a forma anterior, e todos os links davam "a página não existe":
    // a consola do Desk encaminha pelo nome do portal, não pelo id da org.
    expect(urlDoDesk("123", null)).not.toContain("/agent/683863304/");
  });

  it("ignora um webUrl que não seja um endereço https", () => {
    expect(urlDoDesk("123", { webUrl: "javascript:alert(1)" })).toContain("/support/");
    expect(urlDoDesk("123", { webUrl: 42 })).toContain("/support/");
  });
});
