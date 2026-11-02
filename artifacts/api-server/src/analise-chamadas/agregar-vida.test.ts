import { describe, expect, it } from "vitest";
import { agregarEquipaVida, chaveGravacao } from "./agregar-vida.js";
import type { ChamadaParaAgregar } from "./agregar.js";

function ch(o: Partial<ChamadaParaAgregar>): ChamadaParaAgregar {
  return {
    dia: "2026-10-20",
    hora: 10,
    direcao: "out",
    atendida: true,
    estado: null,
    duracaoS: 120,
    esperaS: null,
    agenteId: "20",
    agenteNome: "Ana",
    clienteNumero: "351911111111",
    equipa: "vida",
    ...o,
  };
}

describe("chaveGravacao", () => {
  it("usa o nome do mp3, sem pasta nem query", () => {
    expect(chaveGravacao("https://cdn.ringover.com/records/AbC123.mp3?x=1")).toBe("abc123.mp3");
    expect(chaveGravacao(null)).toBeNull();
    expect(chaveGravacao("https://x/sem-audio")).toBeNull();
  });
});

describe("agregarEquipaVida", () => {
  const base = {
    de: "2026-10-01",
    ate: "2026-10-31",
    nomes: new Map([["20", "Ana Rodrigues"], ["21", "Rute Rio"]]),
  };

  it("conta chamadas, conversas reais (≥ 30 s) e minutos por pessoa", () => {
    const r = agregarEquipaVida({
      ...base,
      chamadas: [
        ch({ duracaoS: 120 }),
        ch({ duracaoS: 20 }),
        ch({ atendida: false, duracaoS: null }),
        ch({ direcao: "in", duracaoS: 60 }),
        ch({ agenteId: "21", duracaoS: 300 }),
      ],
      avaliacoes: [],
      resultados: [],
      gravacoesNoCrm: null,
    });
    const ana = r.porColaborador.find((p) => p.agenteId === "20")!;
    expect(ana).toMatchObject({ nome: "Ana Rodrigues", feitas: 3, recebidas: 1, conversasReais: 2, minutos: 3 });
    expect(ana.conversasReaisPct).toBe(50);
    expect(r.kpis).toMatchObject({ feitas: 4, recebidas: 1, conversasReais: 3, minutos: 8, semLead: null });
    expect(r.porColaborador[0].agenteId).toBe("20"); // mais chamadas primeiro
  });

  it("nota do guião sem 'a rever' nem 'não se aplica', e o ponto mais fraco com 3+ avaliações", () => {
    const avaliacoes = [1, 2, 3].map((id) => ({
      id,
      agenteId: "20",
      colaborador: "Ana",
      estado: "analisada",
      tipo: "primeiro",
      gravacaoUrl: null,
    }));
    const resultados = [
      ...[1, 2, 3].map((id) => ({ chamadaId: id, item: "primeiro.apresentacao", estado: "nao_cumprido", rever: false })),
      ...[1, 2, 3].map((id) => ({ chamadaId: id, item: "primeiro.ajuda", estado: "cumprido", rever: false })),
      { chamadaId: 1, item: "primeiro.ajuda", estado: "nao_cumprido", rever: true },
      { chamadaId: 2, item: "primeiro.reforco", estado: "nao_aplicavel", rever: false },
      { chamadaId: 3, item: "primeiro.reforco", estado: "nao_cumprido", rever: false },
    ];
    const r = agregarEquipaVida({ ...base, chamadas: [], avaliacoes, resultados, gravacoesNoCrm: null });
    const ana = r.porColaborador[0];
    expect(ana.avaliadas).toBe(3);
    expect(ana.guiaoPct).toBe(42.9); // 3 de 7
    expect(ana.pontoMaisFraco?.item).toBe("primeiro.apresentacao");
    expect(ana.pontoMaisFraco?.pct).toBe(0);
    expect(r.kpis.guiaoPct).toBe(42.9);
  });

  it("chamadas sem lead: gravação que não aparece em nenhuma nota do noCRM; curtas ficam fora", () => {
    const av = (id: number, url: string | null, estado = "analisada") => ({
      id,
      agenteId: "20",
      colaborador: "Ana",
      estado,
      tipo: null,
      gravacaoUrl: url,
    });
    const r = agregarEquipaVida({
      ...base,
      chamadas: [],
      avaliacoes: [
        av(1, "https://cdn.ringover.com/records/a.mp3"),
        av(2, "https://cdn.ringover.com/records/b.mp3"),
        av(3, "https://cdn.ringover.com/records/c.mp3", "curta"),
        av(4, null),
      ],
      resultados: [],
      gravacoesNoCrm: new Set(["a.mp3"]),
    });
    expect(r.kpis.semLead).toBe(1);
    expect(r.kpis.semLeadPct).toBe(50);
    expect(r.porColaborador[0].semLead).toBe(1);
  });
});
