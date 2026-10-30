import { describe, expect, it } from "vitest";
import { CHANNELS, CHANNEL_BY_KEY, isLeadOf } from "./channels.js";
import { classifyTipo } from "./tipo.js";
import { applyFilters, buildEmailSummary, buildPeople, buildView, resolvePeriod } from "./compute.js";
import type { LeadRow } from "./types.js";

const ch = (k: string) => CHANNEL_BY_KEY.get(k)!;

function row(p: Partial<LeadRow> & { day: string; channelKey: string }): LeadRow {
  const def = ch(p.channelKey);
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    ticketNumber: "1",
    subject: p.subject ?? "x",
    status: "Novo",
    channelLabel: def.label,
    channelColor: def.color,
    createdTime: `${p.day}T10:00:00.000Z`,
    tipo: "Outros",
    assigneeId: "a1",
    assigneeName: "Ana",
    aberto: true,
    ...p,
  };
}

describe("isLeadOf", () => {
  it("counts Alice tickets only when they are simulations", () => {
    expect(isLeadOf(ch("ALICE"), "Phone", "Alice: Simulação - Fátima S.")).toBe(true);
    expect(isLeadOf(ch("ALICE"), "Phone", "alice: simulacao - sem acento")).toBe(true);
    expect(isLeadOf(ch("ALICE"), "Phone", "Alice: Sinistro - Rui")).toBe(false);
    expect(isLeadOf(ch("ALICE"), "Phone", "Alice: Pedido sem resposta")).toBe(false);
  });

  it("keeps Alice tickets out of the phone simulation channel", () => {
    expect(isLeadOf(ch("TELEFONE"), "Phone", "Alice: Simulação - Fátima")).toBe(false);
    expect(isLeadOf(ch("TELEFONE"), "Phone", "Chamada perdida de 912345678")).toBe(true);
  });

  it("re-checks the Desk channel", () => {
    expect(isLeadOf(ch("EMAIL"), "Phone", "Pedido de simulação")).toBe(false);
    expect(isLeadOf(ch("EMAIL"), "Email", "Pedido de simulação")).toBe(true);
    expect(isLeadOf(ch("EMAIL"), null, "x")).toBe(false);
  });

  it("keeps the SITE subject rule and spacing-tolerant ASISA match", () => {
    expect(isLeadOf(ch("SITE"), "SITE", "SITE: Seguro Auto")).toBe(true);
    expect(isLeadOf(ch("SITE"), "SITE", "Re: dúvida")).toBe(false);
    expect(isLeadOf(ch("LEAD_ASISA"), "LEAD - ASISA", "Simulador")).toBe(true);
  });

  it("filters phone and email searches by Tipo de Pedido = SIMULAÇÃO", () => {
    expect(ch("TELEFONE").customField).toBe("cf_negocio:SIMULAÇÃO");
    expect(ch("EMAIL").customField).toBe("cf_negocio:SIMULAÇÃO");
    expect(CHANNELS).toHaveLength(9);
  });
});

describe("classifyTipo", () => {
  it("uses the fixed type of single-line channels", () => {
    expect(classifyTipo(ch("LEAD_ASISA"), "qualquer coisa")).toBe("Saúde");
    expect(classifyTipo(ch("VCVIDA"), "Crédito")).toBe("Vida");
  });
  it("reads the subject", () => {
    expect(classifyTipo(ch("SITE"), "SITE: Simulação Seguro Automóvel")).toBe("Auto");
    expect(classifyTipo(ch("SITE"), "SITE: Multirriscos Habitação")).toBe("Habitação");
    expect(classifyTipo(ch("SITE"), "SITE: Multirriscos Empresarial")).toBe("Empresas");
    expect(classifyTipo(ch("SITE"), "SITE: Seguro de Saúde familiar")).toBe("Saúde");
    expect(classifyTipo(ch("EMAIL"), "Seguro vida crédito habitação")).toBe("Vida");
    expect(classifyTipo(ch("SITE"), "SITE: Acidentes de Trabalho")).toBe("Empresas");
    expect(classifyTipo(ch("EMAIL"), "VCVIDA - Simulação Seguro MR, Maria M.")).toBe("Habitação");
    expect(classifyTipo(ch("EMAIL"), "Fwd: Seguro AT - Guilherme T.")).toBe("Empresas");
    expect(classifyTipo(ch("EMAIL"), "seguro de trabalho")).toBe("Empresas");
    expect(classifyTipo(ch("BLOG"), "Seguro de animais")).toBe("Outros");
    expect(classifyTipo(ch("BLOG"), null)).toBe("Outros");
  });
  it("falls back to the product name", () => {
    expect(classifyTipo(ch("EMAIL"), "Pedido", "Automóvel")).toBe("Auto");
  });
});

describe("buildPeople", () => {
  it("marks load against the average of named people and keeps unassigned last", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row({ day: "2026-10-20", channelKey: "SITE", assigneeName: "Ana" })),
      ...Array.from({ length: 6 }, () => row({ day: "2026-10-20", channelKey: "SITE", assigneeName: "Rui", aberto: false })),
      ...Array.from({ length: 5 }, () => row({ day: "2026-10-20", channelKey: "EMAIL", assigneeName: "Vânia" })),
      row({ day: "2026-10-20", channelKey: "SITE", assigneeName: "Sem responsável", assigneeId: null }),
    ];
    const { pessoas, media } = buildPeople(rows, "Sem responsável");
    expect(media).toBe(7); // (10 + 6 + 5) / 3
    expect(pessoas.map((p) => p.name)).toEqual(["Ana", "Rui", "Vânia", "Sem responsável"]);
    expect(pessoas[0].carga).toBe("acima30"); // 10 > 9.1
    expect(pessoas[1].carga).toBe("media");
    expect(pessoas[1].abertos).toBe(0);
    expect(pessoas[3].carga).toBe("sem_responsavel");
    expect(pessoas[2].porCanal).toEqual({ EMAIL: 5 });
  });
  it("handles no rows", () => {
    expect(buildPeople([], "Sem responsável")).toEqual({ pessoas: [], media: 0 });
  });
});

describe("buildView with filters", () => {
  const rows = [
    row({ day: "2026-10-28", channelKey: "SITE", tipo: "Auto", assigneeName: "Ana" }),
    row({ day: "2026-10-28", channelKey: "ALICE", tipo: "Habitação", assigneeName: "Rui", aberto: false }),
    row({ day: "2026-10-27", channelKey: "EMAIL", tipo: "Auto", assigneeName: "Sem responsável", assigneeId: null }),
  ];
  const period = resolvePeriod({ preset: "7d" }, "2026-10-29");

  it("counts open, unassigned and types", () => {
    const v = buildView(rows, period, "2026-10-29", 1);
    expect(v.total).toBe(3);
    expect(v.abertos).toBe(2);
    expect(v.semResponsavel).toBe(1);
    expect(v.tipos.find((t) => t.tipo === "Auto")?.total).toBe(2);
    expect(v.breakdown.find((b) => b.key === "ALICE")?.total).toBe(1);
    expect(v.opcoes.pessoas).toEqual(["Ana", "Rui", "Sem responsável"]);
  });

  it("narrows everything by canal, tipo and pessoa but keeps the filter menus whole", () => {
    expect(applyFilters(rows, { tipo: "Auto" })).toHaveLength(2);
    const v = buildView(rows, period, "2026-10-29", 1, { canal: "SITE" });
    expect(v.total).toBe(1);
    expect(v.pessoas.map((p) => p.name)).toEqual(["Ana"]);
    expect(v.opcoes.pessoas).toHaveLength(3);
    expect(buildView(rows, period, "2026-10-29", 1, { pessoa: "Ninguém" }).total).toBe(0);
  });
});

describe("buildEmailSummary", () => {
  it("leaves new channels out of the month-on-month comparison", () => {
    const rows = [
      row({ day: "2026-10-28", channelKey: "SITE", tipo: "Auto" }),
      row({ day: "2026-10-20", channelKey: "SITE", tipo: "Auto" }),
      row({ day: "2026-09-15", channelKey: "SITE", tipo: "Auto" }), // previous 30 days
      row({ day: "2026-10-28", channelKey: "ALICE", tipo: "Saúde" }),
    ];
    const s = buildEmailSummary(rows, "2026-10-29", "https://x/api/leads");
    const site = s.canais.find((c) => c.key === "SITE")!;
    const alice = s.canais.find((c) => c.key === "ALICE")!;
    expect(site).toMatchObject({ ontem: 1, d7: 1, d30: 2, prev30: 1, novo: false });
    expect(alice).toMatchObject({ ontem: 1, d30: 1, prev30: 0, novo: true });
    expect(s.totais).toMatchObject({ ontem: 2, d30: 3, prev30: 1, d30Comparavel: 2, prev30Comparavel: 1 });
    expect(s.tipos.find((t) => t.tipo === "Auto")).toEqual({ tipo: "Auto", total: 2, ontem: 1 });
    expect(s.canais).toHaveLength(9);
    expect(s.periodo).toEqual({ from: "2026-09-30", to: "2026-10-28" });
  });
});
