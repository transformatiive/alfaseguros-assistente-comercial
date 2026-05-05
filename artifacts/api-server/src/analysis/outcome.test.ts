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

describe("classifyOutcome — cf_estado_do_negocio (primary field)", () => {
  it("GANHO → won", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "GANHO" } }));
    expect(out.status).toBe("won");
    expect(out.reason).toContain("GANHO");
  });

  it("PERDIDO → lost", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "PERDIDO" } }));
    expect(out.status).toBe("lost");
    expect(out.reason).toContain("PERDIDO");
  });

  it("EM TRATAMENTO → open", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "EM TRATAMENTO" } }));
    expect(out.status).toBe("open");
    expect(out.reason).toContain("EM TRATAMENTO");
  });

  it("EM ESPERA → open", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "EM ESPERA" } }));
    expect(out.status).toBe("open");
  });

  it("TRATADO → open", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "TRATADO" } }));
    expect(out.status).toBe("open");
  });

  it("case-insensitive match on ganho", () => {
    const out = classifyOutcome(ticket({ cf: { cf_estado_do_negocio: "Ganho" } }));
    expect(out.status).toBe("won");
  });
});

describe("classifyOutcome — fallback rules (no cf_estado_do_negocio)", () => {
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

  it("open when ticket is not closed and no cf signals", () => {
    expect(classifyOutcome(ticket({ status: "Open", statusType: "Open" })).status).toBe("open");
  });

  it("unknown when closed with no matching rule", () => {
    expect(
      classifyOutcome(ticket({ status: "Closed", statusType: "Closed" })).status,
    ).toBe("unknown");
  });
});
