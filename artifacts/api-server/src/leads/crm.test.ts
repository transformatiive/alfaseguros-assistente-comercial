import { describe, expect, it, vi } from "vitest";
import { CHANNEL_BY_KEY } from "./channels.js";
import { buildEmailSummary } from "./compute.js";
import { crmChannelOf, crmLeadAberto, crmLeadToRow, CRM_LEAD_URL, type CrmLead } from "./crm.js";

const lead = (p: Partial<CrmLead>): CrmLead => ({ id: "L1", Created_Time: "2026-11-04T18:20:42+00:00", ...p });

describe("crmChannelOf", () => {
  it("puts every website simulator lead in ASISA / Simulador", () => {
    expect(crmChannelOf(lead({ Lead_Source: "Form Simulador", Produto: "ASISA - Seguro Saude" }))).toBe("LEAD_ASISA");
    expect(crmChannelOf(lead({ Lead_Source: "Form Simulador", Produto: "Seguro de Viagem" }))).toBe("LEAD_ASISA");
    expect(crmChannelOf(lead({ Lead_Source: "form  simulador" }))).toBe("LEAD_ASISA");
  });

  it("puts any lead that names Caravela in Caravela, even from the simulator", () => {
    expect(crmChannelOf(lead({ Produto: "Caravela Auto" }))).toBe("LEAD_CARAVELA");
    expect(crmChannelOf(lead({ Lead_Source: "Form Simulador", Description: "Simulação Caravela" }))).toBe("LEAD_CARAVELA");
  });

  it("leaves other CRM leads out", () => {
    expect(crmChannelOf(lead({ Lead_Source: null, Company: "Transportes Lda" }))).toBeNull();
    expect(crmChannelOf(lead({ Lead_Source: "Referenciação Interna" }))).toBeNull();
  });
});

describe("crmLeadToRow", () => {
  it("builds a dashboard row with the Lisbon day, the product type and a CRM link", () => {
    const r = crmLeadToRow(
      lead({ Full_Name: "Ravi Miguel", Produto: "ASISA - Seguro Acidentes Pessoais", Lead_Status: "simulado", Owner: { id: "u1", name: "João Catalão" } }),
      CHANNEL_BY_KEY.get("LEAD_ASISA")!,
      "Sem responsável",
    )!;
    expect(r).toMatchObject({
      channelKey: "LEAD_ASISA",
      day: "2026-11-04",
      subject: "Ravi Miguel · ASISA - Seguro Acidentes Pessoais",
      tipo: "Saúde",
      assigneeName: "João Catalão",
      aberto: true,
      url: CRM_LEAD_URL("L1"),
    });
  });

  it("does not force Saúde on travel cover from the simulator", () => {
    const r = crmLeadToRow(lead({ Produto: "Seguro de Viagem" }), CHANNEL_BY_KEY.get("LEAD_ASISA")!, "Sem responsável")!;
    expect(r.tipo).toBe("Outros");
    expect(r.assigneeId).toBeNull();
    expect(r.assigneeName).toBe("Sem responsável");
  });

  it("uses the Lisbon day across midnight UTC", () => {
    const r = crmLeadToRow(lead({ Created_Time: "2026-07-01T23:30:00+00:00" }), CHANNEL_BY_KEY.get("LEAD_ASISA")!, "-")!;
    expect(r.day).toBe("2026-07-02");
  });

  it("skips leads with no creation time", () => {
    expect(crmLeadToRow(lead({ Created_Time: null }), CHANNEL_BY_KEY.get("LEAD_ASISA")!, "-")).toBeNull();
  });

  it("counts in the email summary like any other channel", () => {
    const def = CHANNEL_BY_KEY.get("LEAD_ASISA")!;
    const rows = [
      crmLeadToRow(lead({ id: "a", Created_Time: "2026-11-04T10:00:00Z" }), def, "-")!,
      crmLeadToRow(lead({ id: "b", Created_Time: "2026-10-01T10:00:00Z" }), def, "-")!,
    ];
    const s = buildEmailSummary(rows, "2026-11-05", "x");
    expect(s.canais.find((c) => c.key === "LEAD_ASISA")).toMatchObject({ ontem: 1, d30: 1, prev30: 1, novo: false });
  });
});

describe("crmLeadAberto", () => {
  it("treats won, lost and converted leads as closed", () => {
    expect(crmLeadAberto("simulado")).toBe(true);
    expect(crmLeadAberto(null)).toBe(true);
    expect(crmLeadAberto("contratado")).toBe(false);
    expect(crmLeadAberto("Perdido")).toBe(false);
  });
});

describe("fetchCrmLeads", () => {
  it("reads newest first, keeps only the period and stops once it passes the start", async () => {
    process.env.DATABASE_URL ??= "postgres://test";
    process.env.ZOHO_CRM_CLIENT_ID = "id";
    process.env.ZOHO_CRM_CLIENT_SECRET = "secret";
    process.env.ZOHO_CRM_REFRESH_TOKEN = "refresh";
    const urls: string[] = [];
    const page = (data: Partial<CrmLead>[], more: boolean) =>
      new Response(JSON.stringify({ data, info: { more_records: more } }), { status: 200 });
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, Created_Time: "2026-11-03T10:00:00+00:00" }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      if (url.includes("page=1")) return page([{ id: "today", Created_Time: "2026-11-05T09:00:00+00:00" }, ...full.slice(1)], true);
      return page([{ id: "in", Created_Time: "2026-10-07T09:00:00+00:00" }, { id: "old", Created_Time: "2026-09-01T09:00:00+00:00" }], true);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { fetchCrmLeads } = await import("./crm.js");
      const got = await fetchCrmLeads("2026-10-07", "2026-11-04");
      const ids = got.map((l) => l.id);
      expect(ids).toContain("in");
      expect(ids).toContain("n1");
      expect(ids).not.toContain("today");
      expect(ids).not.toContain("old");
      expect(urls.filter((u) => u.includes("/crm/v2/Leads"))).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
