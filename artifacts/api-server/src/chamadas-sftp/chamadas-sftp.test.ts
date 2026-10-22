import { describe, expect, it } from "vitest";
import { conversaEmTexto, lerFicheiro, lerTranscricao, palavras } from "./ficheiro.js";
import { analiseSchema, interpretar, reconciliar } from "./analisar.js";
import { agregar, ordenarPontos, percentagem, periodoUtc } from "./agregar.js";
import { periodoAnterior } from "./painel.js";
import { GUIAO, PONTOS, pontosDoTipo } from "./catalogo.js";

describe("catálogo", () => {
  it("tem os 4 tipos e chaves únicas", () => {
    expect(GUIAO.map((t) => t.id)).toEqual(["primeiro", "seguinte", "proposta", "pos_venda"]);
    const ids = GUIAO.flatMap((t) => t.seccoes.flatMap((s) => s.pontos.map((p) => p.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(PONTOS.size).toBe(ids.length);
  });
});

describe("lerFicheiro", () => {
  it("lê data (hora de Lisboa) e telefone do formato novo", () => {
    const d = lerFicheiro("shared/2026_10_21_10_15_03_123_912345678_0b6f9a4e-1111-2222-3333-444455556666.mp3");
    expect(d.nome).toBe("2026_10_21_10_15_03_123_912345678_0b6f9a4e-1111-2222-3333-444455556666");
    expect(d.telefone).toBe("912345678");
    // 21/10 é hora de verão (UTC+1).
    expect(d.dataHora?.toISOString()).toBe("2026-10-21T09:15:03.000Z");
  });

  it("depois da mudança de hora usa UTC+0", () => {
    const d = lerFicheiro("shared/2026_11_03_09_00_00_001_351912345678_abc.mp3");
    expect(d.dataHora?.toISOString()).toBe("2026-11-03T09:00:00.000Z");
    expect(d.telefone).toBe("351912345678");
  });

  it("formato antigo sem data devolve null (vale a data de upload)", () => {
    const d = lerFicheiro("shared/09_08_17_382_campaign_1394_ALFASEG02_always.mp3");
    expect(d.nome).toBe("09_08_17_382_campaign_1394_ALFASEG02_always");
    expect(d.dataHora).toBeNull();
  });

  it("formato antigo dentro de uma pasta com data usa a pasta e a hora do nome", () => {
    const d = lerFicheiro("shared/2026-10-17/09_08_17_382_campaign_1394_ALFASEG02_always.mp3");
    expect(d.dataHora?.toISOString()).toBe("2026-10-17T08:08:17.000Z");
  });
});

describe("transcrição", () => {
  const bruto = {
    ficheiro: "shared/x.mp3",
    duracao_s: 30,
    segmentos: {
      canal_0: [{ inicio: 3, fim: 5, texto: "Bom dia, sim." }],
      canal_1: [
        { inicio: 0, fim: 2, texto: "Bom dia, fala a Leandra da Alfa Seguros." },
        { inicio: 6, fim: 8, texto: "" },
        { lixo: true },
      ],
    },
  };

  it("valida e junta os canais por ordem de tempo", () => {
    const t = lerTranscricao(bruto);
    expect(t).not.toBeNull();
    expect(conversaEmTexto(t!)).toBe(
      "[00:00] Canal 1: Bom dia, fala a Leandra da Alfa Seguros.\n[00:03] Canal 0: Bom dia, sim.",
    );
    expect(palavras(t!)).toBe(11);
  });

  it("rejeita JSON sem segmentos", () => {
    expect(lerTranscricao({ ficheiro: "x" })).toBeNull();
    expect(lerTranscricao(null)).toBeNull();
  });
});

describe("análise", () => {
  it("reconcilia: um resultado por ponto, ids estranhos fora, omitidos a rever", () => {
    const r = reconciliar("pos_venda", [
      { item: "pos_venda.google", estado: "cumprido", confianca: 0.9, evidencia: "Pediu avaliação." },
      { item: "pos_venda.google", estado: "nao_cumprido", confianca: 0.9, evidencia: "duplicado" },
      { item: "primeiro.preco", estado: "cumprido", confianca: 1, evidencia: "outro tipo" },
      { item: "pos_venda.simulacao", estado: "nao_cumprido", confianca: 0.4, evidencia: "" },
      { item: "pos_venda.outros", estado: "nao_aplicavel", confianca: 0.2, evidencia: "" },
    ]);
    expect(r.map((x) => x.item)).toEqual(pontosDoTipo("pos_venda").map((p) => p.id));
    expect(r.find((x) => x.item === "pos_venda.google")).toMatchObject({ estado: "cumprido", rever: false });
    expect(r.find((x) => x.item === "pos_venda.simulacao")).toMatchObject({ rever: true });
    // "Não se aplica" nunca vai para revisão, mesmo com confiança baixa.
    expect(r.find((x) => x.item === "pos_venda.outros")).toMatchObject({ rever: false });
    expect(r.find((x) => x.item === "pos_venda.oferta")).toMatchObject({ confianca: 0, rever: true });
  });

  it("chamada sem conversa útil fica descartada", () => {
    const a = interpretar(
      analiseSchema.parse({ conversa_util: false, motivo_descarte: "Caixa de correio", resumo: "", resultados: [] }),
    );
    expect(a).toEqual({ util: false, motivo: "Caixa de correio", resumo: "" });
  });

  it("valores fora do esperado não rebentam a validação", () => {
    const a = analiseSchema.parse({
      conversa_util: true,
      tipo: "seguinte",
      resumo: "x",
      desfecho: "talvez",
      objecoes: ["banco", "chuva"],
      resultados: [{ item: "seguinte.nome", estado: "sim", confianca: "0.8" }],
    });
    expect(a.desfecho).toBe("outro");
    expect(a.objecoes).toEqual(["banco", "outra"]);
    expect(a.resultados[0]).toMatchObject({ estado: "nao_cumprido", confianca: 0.8, evidencia: "" });
  });
});

describe("agregar", () => {
  const dia = (iso: string) => new Date(iso);
  const chamadas = [
    { id: 1, dataHora: dia("2026-10-20T09:00:00Z"), estado: "analisada", tipo: "primeiro" },
    { id: 2, dataHora: dia("2026-10-21T09:00:00Z"), estado: "analisada", tipo: "primeiro" },
    { id: 3, dataHora: dia("2026-10-21T10:00:00Z"), estado: "descartada", tipo: null },
    { id: 4, dataHora: dia("2026-10-21T11:00:00Z"), estado: "curta", tipo: null },
    { id: 5, dataHora: dia("2026-10-21T12:00:00Z"), estado: "pendente", tipo: null },
  ];
  const resultados = [
    { chamadaId: 1, item: "primeiro.preco", estado: "cumprido", rever: false },
    { chamadaId: 2, item: "primeiro.preco", estado: "nao_cumprido", rever: false },
    { chamadaId: 1, item: "primeiro.porque", estado: "nao_aplicavel", rever: false },
    { chamadaId: 2, item: "primeiro.gravacao", estado: "cumprido", rever: true },
    // De uma chamada que não está analisada: ignorado.
    { chamadaId: 3, item: "primeiro.preco", estado: "cumprido", rever: false },
  ];

  it("conta KPIs, deixa N/A e 'a rever' fora da %", () => {
    const a = agregar(chamadas, resultados);
    expect(a.kpis).toMatchObject({ recebidas: 5, analisadas: 2, descartadas: 1, curtas: 1, pendentes: 1, aRever: 1 });
    expect(a.kpis.cumprimentoPct).toBe(50);
    const preco = a.pontos.find((p) => p.item === "primeiro.preco");
    expect(preco).toMatchObject({ cumpriu: 1, nao: 1, rever: 0, total: 2, pct: 50 });
    expect(a.pontos.find((p) => p.item === "primeiro.porque")).toMatchObject({ naoAplicavel: 1, total: 0, pct: null });
    expect(a.porTipo.find((t) => t.tipo === "primeiro")).toMatchObject({ chamadas: 2, pct: 50 });
    expect(a.porDia).toEqual([
      { data: "2026-10-20", chamadas: 1, pct: 100 },
      { data: "2026-10-21", chamadas: 1, pct: 0 },
    ]);
  });

  it("ordena pontos do mais fraco para o mais forte, com base mínima", () => {
    const a = agregar(chamadas, resultados);
    expect(ordenarPontos(a.pontos, 2).map((p) => p.item)).toEqual(["primeiro.preco"]);
    expect(ordenarPontos(a.pontos, 3)).toEqual([]);
  });

  it("percentagem sem base é null", () => {
    expect(percentagem({ cumpriu: 0, nao: 0 })).toBeNull();
    expect(percentagem({ cumpriu: 2, nao: 1 })).toBe(66.7);
  });
});

describe("períodos", () => {
  it("datas de Lisboa para intervalo UTC", () => {
    const p = periodoUtc("2026-10-21", "2026-10-21");
    expect(p.de.toISOString()).toBe("2026-10-20T23:00:00.000Z");
    expect(p.ate.toISOString()).toBe("2026-10-21T23:00:00.000Z");
    const inverno = periodoUtc("2026-11-02", "2026-11-03");
    expect(inverno.de.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(inverno.ate.toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });

  it("período anterior com a mesma duração", () => {
    expect(periodoAnterior("2026-10-15", "2026-10-21")).toEqual({ de: "2026-10-08", ate: "2026-10-14" });
  });
});
