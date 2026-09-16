import { describe, expect, it } from "vitest";
import {
  DURACAO_MINIMA_SEG,
  porqueContinuaAberta,
  procurarProva,
  type ChamadaParaEvidencia,
  type PedidoDeProva,
  type RespostaParaEvidencia,
} from "./evidencia.js";
import { derivarCadeia } from "./cadeia.js";

const PEDIDO: PedidoDeProva = {
  // O caso genérico aceita as duas provas — é o que `cumprir_compromisso` faz.
  // Os testes que precisam de uma só sobrepõem `aceita`.
  aceita: ["chamada", "resposta"],
  diaDoCompromisso: "2026-09-03",
  desde: "2026-09-03T17:00:00.000Z",
  fingerprint: "917240802",
  ticketId: "tkt-1",
};

const chamada = (p: Partial<ChamadaParaEvidencia> = {}): ChamadaParaEvidencia => ({
  fingerprint: "917240802",
  dia: "2026-09-05",
  atendida: true,
  duracaoSeg: 360,
  ...p,
});

const resposta = (p: Partial<RespostaParaEvidencia> = {}): RespostaParaEvidencia => ({
  ticketId: "tkt-1",
  quando: "2026-09-05T09:07:00.000Z",
  autorTipo: "AGENT",
  ticketNumber: "172063",
  ...p,
});

describe("procurarProva — o que conta como feito", () => {
  it("uma chamada atendida posterior fecha a tarefa", () => {
    expect(procurarProva(PEDIDO, [chamada()], [])).toEqual({
      tipo: "chamada",
      descricao: "chamada atendida de 6 min a 05/09",
    });
  });

  it("uma resposta de um agente no ticket fecha a tarefa", () => {
    expect(procurarProva(PEDIDO, [], [resposta()])).toEqual({
      tipo: "resposta",
      descricao: "resposta enviada no ticket #172063 a 05/09",
    });
  });
});

describe("procurarProva — o que NÃO conta, que é o que importa", () => {
  it("uma chamada curta é o atendedor, não uma devolução", () => {
    expect(procurarProva(PEDIDO, [chamada({ duracaoSeg: 8 })], [])).toBeNull();
    expect(
      procurarProva(PEDIDO, [chamada({ duracaoSeg: DURACAO_MINIMA_SEG - 1 })], []),
    ).toBeNull();
    expect(procurarProva(PEDIDO, [chamada({ duracaoSeg: DURACAO_MINIMA_SEG })], [])).not.toBeNull();
  });

  it("uma duração desconhecida é uma dúvida, e uma dúvida não fecha nada", () => {
    expect(procurarProva(PEDIDO, [chamada({ duracaoSeg: null })], [])).toBeNull();
  });

  it("uma chamada não atendida não é prova nenhuma", () => {
    expect(procurarProva(PEDIDO, [chamada({ atendida: false })], [])).toBeNull();
  });

  it("a chamada do próprio dia é a causa da tarefa, não a cura", () => {
    expect(procurarProva(PEDIDO, [chamada({ dia: "2026-09-03" })], [])).toBeNull();
    expect(procurarProva(PEDIDO, [chamada({ dia: "2026-09-01" })], [])).toBeNull();
  });

  it("outro número não fecha esta tarefa", () => {
    expect(procurarProva(PEDIDO, [chamada({ fingerprint: "913888846" })], [])).toBeNull();
  });

  it("um comentário do sistema ou do cliente não é uma resposta nossa", () => {
    expect(procurarProva(PEDIDO, [], [resposta({ autorTipo: "SYSTEM" })])).toBeNull();
    expect(procurarProva(PEDIDO, [], [resposta({ autorTipo: "END_USER" })])).toBeNull();
    expect(procurarProva(PEDIDO, [], [resposta({ autorTipo: null })])).toBeNull();
  });

  it("uma resposta anterior ao compromisso não o cumpre", () => {
    expect(
      procurarProva(PEDIDO, [], [resposta({ quando: "2026-09-02T09:00:00.000Z" })]),
    ).toBeNull();
  });

  it("sem número e sem ticket não há prova possível — a tarefa fica", () => {
    expect(
      procurarProva(
        {
      aceita: ["chamada", "resposta"],
      diaDoCompromisso: null,
      desde: null,
      fingerprint: null,
      ticketId: null,
    },
        [chamada()],
        [resposta()],
      ),
    ).toBeNull();
  });
});

describe("porqueContinuaAberta", () => {
  it("diz o que foi procurado e não encontrado", () => {
    expect(porqueContinuaAberta(PEDIDO)).toBe(
      "Sem chamada atendida para este número desde 03/09 e sem resposta tua no ticket.",
    );
  });

  it("cala-se quando não havia onde procurar", () => {
    expect(
      porqueContinuaAberta({
        aceita: ["chamada", "resposta"],
        diaDoCompromisso: null,
        desde: null,
        fingerprint: null,
        ticketId: null,
      }),
    ).toBeNull();
  });
});

describe("derivarCadeia", () => {
  it("uma simulação pedida e não enviada põe o buraco na simulação", () => {
    const c = derivarCadeia({
      pedidoEm: "2026-09-02T10:00:00.000Z",
      envolveSimulacao: true,
      simulacaoEnviadaEm: null,
      ultimoContactoNosso: null,
    });
    expect(c.emFalta).toBe("simulacao");
    expect(c.passos.map((p) => p.estado)).toEqual(["feito", "em_falta", "nao_aplicavel"]);
  });

  it("uma simulação enviada e nunca seguida põe o buraco no follow-up", () => {
    const c = derivarCadeia({
      pedidoEm: "2026-08-25T10:00:00.000Z",
      envolveSimulacao: true,
      simulacaoEnviadaEm: "2026-08-26T10:00:00.000Z",
      ultimoContactoNosso: "2026-08-26T10:00:00.000Z",
    });
    expect(c.emFalta).toBe("follow_up");
  });

  it("um contacto posterior à simulação fecha a cadeia", () => {
    const c = derivarCadeia({
      pedidoEm: "2026-08-25T10:00:00.000Z",
      envolveSimulacao: true,
      simulacaoEnviadaEm: "2026-08-26T10:00:00.000Z",
      ultimoContactoNosso: "2026-09-01T10:00:00.000Z",
    });
    expect(c.emFalta).toBeNull();
    expect(c.passos.map((p) => p.estado)).toEqual(["feito", "feito", "feito"]);
  });

  it("nunca pede um follow-up de uma simulação que não saiu", () => {
    const c = derivarCadeia({
      pedidoEm: "2026-09-02T10:00:00.000Z",
      envolveSimulacao: true,
      simulacaoEnviadaEm: null,
      ultimoContactoNosso: "2026-09-06T10:00:00.000Z",
    });
    expect(c.emFalta).toBe("simulacao");
    expect(c.passos[2].estado).toBe("nao_aplicavel");
  });

  it("um assunto que não é simulação salta o passo do meio", () => {
    const c = derivarCadeia({
      pedidoEm: "2026-08-18T10:00:00.000Z",
      envolveSimulacao: false,
      simulacaoEnviadaEm: null,
      ultimoContactoNosso: null,
    });
    expect(c.emFalta).toBeNull();
    expect(c.passos.map((p) => p.estado)).toEqual(["feito", "nao_aplicavel", "nao_aplicavel"]);
  });
});


/**
 * A prova tem de ser do mesmo género que a promessa.
 *
 * Num dia real, as oito tarefas dadas como feitas eram todas "devolver
 * chamada" e todas fechadas por um comentário no ticket. Devolver uma chamada
 * prova-se com uma chamada — e um comentário pode até dizer "o cliente não
 * atendeu", que é o contrário de resolvido.
 */
describe("a prova tem de corresponder à promessa", () => {
  const respostaDepois = (): RespostaParaEvidencia => ({
    ticketId: "tkt-1",
    quando: "2026-09-04T09:00:00.000Z",
    autorTipo: "AGENT",
    ticketNumber: "1234",
  });

  const chamadaDepois = (): ChamadaParaEvidencia => ({
    fingerprint: "917240802",
    dia: "2026-09-04",
    atendida: true,
    duracaoSeg: 120,
  });

  it("uma devolução não se fecha com um comentário no ticket", () => {
    expect(
      procurarProva({ ...PEDIDO, aceita: ["chamada"] }, [], [respostaDepois()]),
    ).toBeNull();
  });

  it("uma devolução fecha-se com uma chamada atendida", () => {
    const prova = procurarProva({ ...PEDIDO, aceita: ["chamada"] }, [chamadaDepois()], []);
    expect(prova?.tipo).toBe("chamada");
  });

  it("um envio de simulação não se fecha com uma chamada atendida", () => {
    // Falar com o cliente não é enviar-lhe a simulação. Podem ter falado
    // precisamente para dizer que ela ainda não seguiu.
    expect(
      procurarProva({ ...PEDIDO, aceita: ["resposta"] }, [chamadaDepois()], []),
    ).toBeNull();
  });

  it("um envio de simulação fecha-se com uma resposta no ticket", () => {
    const prova = procurarProva({ ...PEDIDO, aceita: ["resposta"] }, [], [respostaDepois()]);
    expect(prova?.tipo).toBe("resposta");
  });

  it("uma lista vazia de provas aceites nunca fecha nada", () => {
    expect(
      procurarProva({ ...PEDIDO, aceita: [] }, [chamadaDepois()], [respostaDepois()]),
    ).toBeNull();
  });

  it("a linha cinzenta só fala das provas que contam", () => {
    // Um rodapé a dizer "sem resposta tua no ticket" numa tarefa que nem por
    // resposta se fecha manda a pessoa fazer a coisa errada.
    expect(porqueContinuaAberta({ ...PEDIDO, aceita: ["chamada"] })).toBe(
      "Sem chamada atendida para este número desde 03/09.",
    );
    expect(porqueContinuaAberta({ ...PEDIDO, aceita: ["resposta"] })).toBe(
      "Sem resposta tua no ticket.",
    );
  });
});
