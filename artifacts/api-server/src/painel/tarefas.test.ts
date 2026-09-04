import { describe, expect, it } from "vitest";
import {
  agruparTarefas,
  derivarTarefas,
  ehAcaoDeConversa,
  ehTarefaDoDesk,
  impressaoDigital,
  pedeSimulacao,
  prometeSimulacao,
  resumirPromessa,
  type EntradaTarefas,
} from "./tarefas.js";

const AGORA = new Date("2026-08-29T09:00:00.000Z");

function entrada(p: Partial<EntradaTarefas> = {}): EntradaTarefas {
  return {
    devolucoes: [],
    followUps: [],
    tickets: [],
    acoes: [],
    nomePorFingerprint: new Map(),
    emailPorFingerprint: new Map(),
    now: AGORA,
    ...p,
  };
}

describe("ehTarefaDoDesk", () => {
  it("apanha os lembretes de tarefa do Desk, que vão ser substituídos por este painel", () => {
    expect(ehTarefaDoDesk("Reminder for your task")).toBe(true);
    expect(ehTarefaDoDesk("Reminder for your task: ligar ao cliente")).toBe(true);
    expect(ehTarefaDoDesk("Lembrete para a sua tarefa")).toBe(true);
  });

  it("não apanha um pedido verdadeiro que por acaso fala de tarefas", () => {
    expect(ehTarefaDoDesk("Cliente pede tarefa de renovação")).toBe(false);
    expect(ehTarefaDoDesk(null)).toBe(false);
  });
});

describe("pedeSimulacao", () => {
  it("reconhece as várias palavras que a equipa usa para a mesma coisa", () => {
    for (const t of [
      "Pedido de simulação para seguro automóvel",
      "Simulação Seguro MR",
      "Preciso de uma cotação",
      "Enviar orçamento até sexta",
      "Fwd: Pedido de proposta — Responsabilidade Civil",
    ]) {
      expect(pedeSimulacao(t), t).toBe(true);
    }
  });

  it("não dispara com um pedido que não é uma simulação", () => {
    expect(pedeSimulacao("Alteração de morada")).toBe(false);
    expect(pedeSimulacao(null)).toBe(false);
  });
});

describe("prometeSimulacao", () => {
  it("exige o verbo além do substantivo — uma promessa é uma frase sobre um acto", () => {
    // O falso positivo real que isto veio corrigir: a promessa é de LIGAR.
    expect(
      prometeSimulacao(
        "Contactar a cliente até segunda-feira com uma atualização concreta sobre a decisão da seguradora relativa à proposta de Multirriscos.",
      ),
    ).toBe(false);
  });

  it("dispara quando a simulação é mesmo aquilo que vai ser produzido ou enviado", () => {
    for (const t of [
      "Enviar a simulação de multirriscos até amanhã",
      "Preparar a cotação para o cliente",
      "Elaborar a proposta de responsabilidade civil",
      "Remeter o orçamento por email",
    ]) {
      expect(prometeSimulacao(t), t).toBe(true);
    }
  });

  it("não confunde com o assunto de um ticket, onde o substantivo basta", () => {
    // O mesmo texto classifica de maneira diferente conforme a origem, e isso
    // é deliberado: um assunto do Desk *é* o pedido; uma promessa não.
    expect(pedeSimulacao("VCVIDA - Simulação Seguro Multirriscos - Pedro Marques")).toBe(true);
    expect(prometeSimulacao("VCVIDA - Simulação Seguro Multirriscos - Pedro Marques")).toBe(false);
  });
});

describe("resumirPromessa", () => {
  it("tira o preâmbulo de bookkeeping — o painel já é a tarefa", () => {
    const r = resumirPromessa(
      "Registar no Desk uma tarefa para tentar apurar a data de renovação do seguro de Saúde.",
    );
    expect(r).toBe("Tentar apurar a data de renovação do seguro de Saúde");
  });

  it("fica pela primeira oração, que é o acto principal", () => {
    const r = resumirPromessa("Ligar ao cliente amanhã. Depois enviar o email de confirmação.");
    expect(r).toBe("Ligar ao cliente amanhã");
  });

  it("corta numa fronteira de palavra, nunca a meio de uma", () => {
    const longa = "Confirmar com o cliente todos os documentos essenciais do processo de crédito habitação e da apólice associada";
    const r = resumirPromessa(longa, 40);
    expect(r.length).toBeLessThanOrEqual(41);
    expect(r.endsWith("…")).toBe(true);
    // The real requirement is that the cut fell on a word boundary: what we
    // kept must be followed by a space in the original, never by more letters.
    const mantido = r.slice(0, -1);
    expect(longa.toLowerCase().startsWith(mantido.toLowerCase())).toBe(true);
    expect(longa[mantido.length]).toBe(" ");
  });

  it("não deixa o título pendurado numa preposição", () => {
    const r = resumirPromessa(
      "Tentar apurar a data de renovação do seguro de Saúde do cliente na Lusitânia hoje",
      68,
    );
    expect(r).not.toMatch(/\b(de|da|do|na|no|em|para|com|a|o|e)…$/i);
    expect(r.endsWith("…")).toBe(true);
  });

  it("nunca devolve vazio", () => {
    expect(resumirPromessa("Registar no Desk uma tarefa para ")).toBe(
      "Cumprir o que foi combinado",
    );
  });
});

describe("impressaoDigital", () => {
  it("junta os formatos do Ringover e do Desk nos últimos nove dígitos", () => {
    expect(impressaoDigital("351919852209")).toBe("919852209");
    expect(impressaoDigital("+351 919 852 209")).toBe("919852209");
  });

  it("devolve null quando não há dígitos que cheguem", () => {
    expect(impressaoDigital("1234")).toBeNull();
    expect(impressaoDigital(null)).toBeNull();
  });
});

describe("ehAcaoDeConversa", () => {
  it("deixa de fora a qualidade e os desvios — isso é coaching, não é uma tarefa", () => {
    expect(ehAcaoDeConversa("desvio_procedimento")).toBe(false);
    expect(ehAcaoDeConversa("qualidade_critica")).toBe(false);
    expect(ehAcaoDeConversa("risco_perda_lead")).toBe(true);
    expect(ehAcaoDeConversa("oportunidade_cross_sell")).toBe(true);
  });
});

describe("derivarTarefas", () => {
  it("dá nome e email a uma chamada, a partir do que o Desk sabe do número", () => {
    const t = derivarTarefas(
      entrada({
        devolucoes: [
          {
            ids: [1],
            numeroCliente: "351919852209",
            tentativas: 3,
            primeiraChamada: "2026-08-29T07:00:00.000Z",
            contexto: "Queria falar sobre a renovação",
            ticketId: null,
            atribuicaoOrigem: "ticket",
          },
        ],
        nomePorFingerprint: new Map([["919852209", "Marco Pacheco"]]),
        emailPorFingerprint: new Map([["919852209", "marco@exemplo.pt"]]),
      }),
    );

    expect(t).toHaveLength(1);
    expect(t[0].categoria).toBe("devolver_chamada");
    expect(t[0].titulo).toBe("Devolver chamada — 3 tentativas");
    expect(t[0].contacto).toEqual({
      nome: "Marco Pacheco",
      telefone: "351919852209",
      email: "marco@exemplo.pt",
    });
    expect(t[0].esperaHoras).toBe(2);
    // The row has a "Devolvida" button, and the button needs these.
    expect(t[0].devolucaoIds).toEqual([1]);
    expect(t[0].atribuicaoOrigem).toBe("ticket");
  });

  it("separa uma promessa de simulação de uma promessa qualquer", () => {
    const base = {
      contact_phone: "351919852209",
      contact_email: null,
      follow_up_sla_hours: 24,
      linked_ticket_id: null,
      detected_at: "2026-08-29T08:00:00.000Z",
    };
    const t = derivarTarefas(
      entrada({
        followUps: [
          { ...base, id: "a", follow_up_descricao: "Enviar simulação de multirriscos", product: "Multirriscos" },
          { ...base, id: "b", follow_up_descricao: "Confirmar a morada com o cliente", product: null },
        ],
      }),
    );

    expect(t.map((x) => x.categoria)).toEqual(["enviar_simulacao", "cumprir_compromisso"]);
    expect(t[0].titulo).toBe("Enviar simulação — Multirriscos");
    expect(t[1].titulo).toBe("Confirmar a morada com o cliente");
    // Both carry the deadline, because "for whom and by when" is the point.
    expect(t[0].prazo).toBe("2026-08-30T08:00:00.000Z");
  });

  it("marca como alta uma promessa que já passou do prazo", () => {
    const t = derivarTarefas(
      entrada({
        followUps: [
          {
            id: "a",
            contact_phone: null,
            contact_email: null,
            follow_up_descricao: "Ligar ao cliente",
            follow_up_sla_hours: 24,
            linked_ticket_id: null,
            product: null,
            // Detected two days ago: the 24h SLA is long gone.
            detected_at: "2026-08-27T08:00:00.000Z",
          },
        ],
      }),
    );
    expect(t[0].prioridade).toBe("alta");
  });

  it("divide os tickets entre o que espera por nós e o que espera pelo cliente", () => {
    const base = {
      ticketNumber: "1",
      idadeHoras: 30,
      criadoEm: "2026-08-28T03:00:00.000Z",
      deskUrl: "https://desk/1",
      contactName: "Ana",
      contactPhone: "351911111111",
      contactEmail: null,
    };
    const t = derivarTarefas(
      entrada({
        tickets: [
          { ...base, id: "1", subject: "Alteração de morada", status: "Novo" },
          { ...base, id: "2", subject: "Apólice enviada", status: "Espera Cliente" },
          { ...base, id: "3", subject: "Aguarda seguradora", status: "Espera Companhia" },
        ],
      }),
    );

    expect(t.map((x) => x.categoria)).toEqual([
      "espera_alfa",
      "espera_cliente",
      "espera_cliente",
    ]);
    // The verbatim status survives, so the row can say which of the two it is.
    expect(t[2].estado).toBe("Espera Companhia");
  });

  it("deixa cair os lembretes de tarefa do Desk", () => {
    const t = derivarTarefas(
      entrada({
        tickets: [
          {
            id: "1",
            ticketNumber: "1",
            subject: "Reminder for your task",
            status: "Novo",
            idadeHoras: 30,
            criadoEm: "2026-08-28T03:00:00.000Z",
            deskUrl: "https://desk/1",
            contactName: null,
            contactPhone: null,
            contactEmail: null,
          },
        ],
      }),
    );
    expect(t).toEqual([]);
  });

  it("um ticket que pede uma simulação conta como simulação, não como fila do Desk", () => {
    const t = derivarTarefas(
      entrada({
        tickets: [
          {
            id: "1",
            ticketNumber: "1",
            subject: "Pedido de simulação para seguro automóvel",
            status: "Fazer Simulação",
            idadeHoras: 30,
            criadoEm: "2026-08-28T03:00:00.000Z",
            deskUrl: "https://desk/1",
            contactName: "Ana",
            contactPhone: null,
            contactEmail: "ana@exemplo.pt",
          },
        ],
      }),
    );
    expect(t[0].categoria).toBe("enviar_simulacao");
    expect(t[0].contacto.email).toBe("ana@exemplo.pt");
  });

  it("nunca trata como urgente algo que está à espera de terceiros, por muito velho que seja", () => {
    const t = derivarTarefas(
      entrada({
        tickets: [
          {
            id: "1",
            ticketNumber: "1",
            subject: "Aguarda resposta",
            status: "Espera Cliente",
            idadeHoras: 500,
            criadoEm: "2026-08-08T03:00:00.000Z",
            deskUrl: "https://desk/1",
            contactName: null,
            contactPhone: null,
            contactEmail: null,
          },
        ],
      }),
    );
    expect(t[0].prioridade).toBe("baixa");
  });

  it("deixa de fora as ações de qualidade e guarda as de conversa", () => {
    const base = { prioridade: "media" as const, descricao: "d", customerPhone: "351911111111", contactName: null };
    const t = derivarTarefas(
      entrada({
        acoes: [
          { ...base, id: "1", tipo: "qualidade_critica", titulo: "Qualidade crítica — 2/5" },
          { ...base, id: "2", tipo: "risco_perda_lead", titulo: "Risco alto de perda de lead" },
        ],
      }),
    );
    expect(t).toHaveLength(1);
    expect(t[0].categoria).toBe("retomar_conversa");
  });
});

describe("agruparTarefas", () => {
  it("ordena as categorias por quem está à espera, não por tamanho", () => {
    const t = derivarTarefas(
      entrada({
        devolucoes: [
          {
            ids: [1],
            numeroCliente: "351919852209",
            tentativas: 1,
            primeiraChamada: "2026-08-29T07:00:00.000Z",
            contexto: null,
            ticketId: null,
            atribuicaoOrigem: null,
          },
        ],
        tickets: [
          {
            id: "1",
            ticketNumber: "1",
            subject: "Espera",
            status: "Espera Cliente",
            idadeHoras: 30,
            criadoEm: "2026-08-28T03:00:00.000Z",
            deskUrl: "https://desk/1",
            contactName: null,
            contactPhone: null,
            contactEmail: null,
          },
          {
            id: "2",
            ticketNumber: "2",
            subject: "Novo pedido",
            status: "Novo",
            idadeHoras: 30,
            criadoEm: "2026-08-28T03:00:00.000Z",
            deskUrl: "https://desk/2",
            contactName: null,
            contactPhone: null,
            contactEmail: null,
          },
        ],
      }),
    );

    expect(agruparTarefas(t).map((g) => g.categoria)).toEqual([
      "devolver_chamada",
      "espera_alfa",
      "espera_cliente",
    ]);
  });

  it("dentro de uma categoria, urgência primeiro e depois quem espera há mais tempo", () => {
    const base = {
      ticketNumber: "1",
      criadoEm: "2026-08-28T03:00:00.000Z",
      deskUrl: "https://desk/1",
      status: "Novo",
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    };
    const t = derivarTarefas(
      entrada({
        tickets: [
          { ...base, id: "1", subject: "Recente", idadeHoras: 30 },
          { ...base, id: "2", subject: "Velho", idadeHoras: 100 },
          { ...base, id: "3", subject: "Menos velho", idadeHoras: 80 },
        ],
      }),
    );

    const grupo = agruparTarefas(t)[0];
    // 100h and 80h are both past the 72h line, so both are `alta` and sort by
    // age; the 30h one is `media` and sinks below them regardless.
    expect(grupo.tarefas.map((x) => x.titulo)).toEqual(["Velho", "Menos velho", "Recente"]);
  });
});
