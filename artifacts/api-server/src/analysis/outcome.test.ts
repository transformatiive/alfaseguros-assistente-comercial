import { describe, expect, it } from "vitest";
import { classifyOutcome } from "./outcome.js";
import type { ZohoTicket } from "@workspace/zoho-desk";

function ticket(o: Partial<ZohoTicket> & { id?: string } = {}): ZohoTicket {
  return {
    id: o.id ?? "T1",
    status: o.status ?? "Open",
    statusType: o.statusType ?? "Open",
    cf: o.cf ?? {},
    ...o,
  };
}

describe("classifyOutcome (stub rules — replace after probe)", () => {
  it("won when cf_apolice_emitida is 'Sim'", () => {
    const out = classifyOutcome(ticket({ cf: { cf_apolice_emitida: "Sim" } }));
    expect(out.status).toBe("won");
    expect(out.reason).toContain("Sim");
  });

  it("lost when cf_motivo_perda is populated", () => {
    const out = classifyOutcome(
      ticket({ status: "Closed", statusType: "Closed", cf: { cf_motivo_perda: "Preço" } }),
    );
    expect(out.status).toBe("lost");
    expect(out.reason).toContain("Preço");
  });

  it("won/lost via cf_estado_negociacao keywords", () => {
    expect(classifyOutcome(ticket({ cf: { cf_estado_negociacao: "Fechado-Ganho" } })).status).toBe("won");
    expect(classifyOutcome(ticket({ cf: { cf_estado_negociacao: "Perdido" } })).status).toBe("lost");
    expect(classifyOutcome(ticket({ cf: { cf_estado_negociacao: "Em curso" } })).status).toBe("open");
  });

  it("open when ticket is not closed and no cf signals", () => {
    expect(classifyOutcome(ticket({ status: "Open", statusType: "Open" })).status).toBe("open");
  });

  it("unknown when closed with no matching rule", () => {
    expect(
      classifyOutcome(ticket({ status: "Closed", statusType: "Closed" })).status,
    ).toBe("unknown");
  });
});
