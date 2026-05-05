import { describe, expect, it } from "vitest";
import {
  conversationAnalysisSchema,
  dailySummarySchema,
  operatorSummarySchema,
} from "./schema.js";

const validConversation = {
  categoria: "Cotação",
  produto: "TVDE",
  narrativaConversa: "Cliente ligou a pedir simulação. Operador apresentou opções e ficou de enviar email.",
  arcoConversa: "Frio→Quente",
  sentimentoClienteEvolucao: "Cliente começou cético e ficou interessado.",
  qualidadeGlobal: 4,
  continuidade: "",
  desviosProcedimento: [
    {
      severidade: "media",
      titulo: "Sem confirmação de identidade",
      detalhe: "Operador não confirmou NIF antes de avançar.",
      chamadaEspecifica: "10:05",
    },
  ],
  pontosPositivos: ["Boa escuta ativa.", "Apresentou 2 seguradoras."],
  feedbackSupervisor: "Marina, foste assertiva mas faltou o NIF.",
  sugestaoEspecialista: "Considera cross-sell de seguro de saúde.",
  followUpNecessario: true,
  followUpDescricao: "Ligar quinta-feira de manhã para confirmar.",
  riscoPerdaLead: "medio",
  tags: ["TVDE", "PROMESSA RETORNO"],
};

describe("conversationAnalysisSchema", () => {
  it("accepts a canonical analysis", () => {
    expect(conversationAnalysisSchema.safeParse(validConversation).success).toBe(true);
  });

  it("rejects qualidadeGlobal out of 1-5 range", () => {
    expect(
      conversationAnalysisSchema.safeParse({ ...validConversation, qualidadeGlobal: 6 }).success,
    ).toBe(false);
    expect(
      conversationAnalysisSchema.safeParse({ ...validConversation, qualidadeGlobal: 0 }).success,
    ).toBe(false);
  });

  it("rejects unknown severidade values", () => {
    const bad = {
      ...validConversation,
      desviosProcedimento: [{ ...validConversation.desviosProcedimento[0], severidade: "critical" }],
    };
    expect(conversationAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown riscoPerdaLead values", () => {
    expect(
      conversationAnalysisSchema.safeParse({ ...validConversation, riscoPerdaLead: "unknown" }).success,
    ).toBe(false);
  });

  it("requires every field — partial payloads fail", () => {
    const partial = { ...validConversation };
    delete (partial as Record<string, unknown>).feedbackSupervisor;
    expect(conversationAnalysisSchema.safeParse(partial).success).toBe(false);
  });
});

describe("dailySummarySchema", () => {
  const valid = {
    executiveSummary: "Dia normal com volume médio. Andreia C. brilhou em fechos de TVDE.",
    workingWell: { paragraph: "Tom geral foi positivo.", bullets: ["Andreia C. fechou 3 cotações", "Boa escuta"] },
    toImprove: { paragraph: "Falta confirmação de identidade.", bullets: ["3 chamadas sem NIF"] },
    risks: { paragraph: "Dois leads sem follow-up agendado.", bullets: ["351911000000", "351922000000"] },
    closingRateRecommendations: { paragraph: "Apertar follow-ups.", bullets: ["Combinar data específica em vez de 'quando puder'"] },
    automationOpportunities: {
      paragraph: "Padrão de pedido de 2ª via de recibo.",
      items: [
        {
          pattern: "Pedido de 2ª via de recibo",
          conversationCountEstimate: 8,
          channel: "Telefone",
          feasibility: "alta",
          notes: "Pode ser self-service no portal.",
        },
      ],
    },
  };

  it("accepts a canonical daily summary", () => {
    expect(dailySummarySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects sections missing paragraph or bullets", () => {
    const bad = { ...valid, workingWell: { paragraph: "x" } };
    expect(dailySummarySchema.safeParse(bad).success).toBe(false);
  });
});

describe("operatorSummarySchema", () => {
  it("accepts a canonical operator coaching payload", () => {
    expect(
      operatorSummarySchema.safeParse({
        paragraphOverview: "Marina teve um dia positivo, com 5 cotações e 1 fecho.",
        strengths: ["Escuta ativa.", "Apresentou múltiplas seguradoras."],
        blindSpots: ["Não pede NIF.", "Não combina data específica de retorno."],
        closingRateObservations: "Captou 3 oportunidades reais; perdeu 1 por falta de follow-up.",
        coachingRecommendations: ["Combinar data concreta no fecho.", "Pedir NIF logo no início."],
      }).success,
    ).toBe(true);
  });
});
