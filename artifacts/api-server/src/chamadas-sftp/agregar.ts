import { GUIAO, PONTOS, type TipoChamada } from "./catalogo.js";

/**
 * Contas do painel "Análise de Chamadas". Funções puras sobre as linhas da
 * base de dados, para se poderem testar sem base.
 *
 * Regras (acordadas com a Soraia a 21/10/2026):
 * - "Não se aplica" fica fora do total: não penaliza o colaborador.
 * - "A rever" (confiança baixa) também fica fora da %: só conta o que o modelo
 *   decidiu com segurança. Aparece à parte para alguém ouvir a chamada.
 * - % cumprimento = cumpriu ÷ (cumpriu + não cumpriu).
 */

export interface ChamadaParaContas {
  id: number;
  dataHora: Date;
  estado: string;
  tipo: string | null;
}

export interface ResultadoParaContas {
  chamadaId: number;
  item: string;
  estado: string;
  rever: boolean;
}

export interface Contagem {
  cumpriu: number;
  nao: number;
  rever: number;
  naoAplicavel: number;
}

const zero = (): Contagem => ({ cumpriu: 0, nao: 0, rever: 0, naoAplicavel: 0 });

function somar(c: Contagem, r: ResultadoParaContas): void {
  if (r.estado === "nao_aplicavel") c.naoAplicavel += 1;
  else if (r.rever) c.rever += 1;
  else if (r.estado === "cumprido") c.cumpriu += 1;
  else c.nao += 1;
}

/** % com uma casa decimal, ou null quando não há nada decidido. */
export function percentagem(c: Pick<Contagem, "cumpriu" | "nao">): number | null {
  const base = c.cumpriu + c.nao;
  return base === 0 ? null : Math.round((c.cumpriu / base) * 1000) / 10;
}

/** Dia de calendário em Lisboa (YYYY-MM-DD). */
export function diaLisboa(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(d);
}

export interface PontoAgregado extends Contagem {
  item: string;
  tipo: TipoChamada;
  seccao: string;
  validacao: string;
  pergunta: string;
  total: number;
  pct: number | null;
}

export interface Agregado {
  kpis: {
    recebidas: number;
    analisadas: number;
    descartadas: number;
    curtas: number;
    pendentes: number;
    erros: number;
    cumprimentoPct: number | null;
    aRever: number;
  };
  porTipo: Array<{ tipo: TipoChamada; nome: string; chamadas: number; pct: number | null }>;
  porDia: Array<{ data: string; chamadas: number; pct: number | null }>;
  pontos: PontoAgregado[];
}

export function agregar(chamadas: ChamadaParaContas[], resultados: ResultadoParaContas[]): Agregado {
  const analisadas = chamadas.filter((c) => c.estado === "analisada");
  const idsAnalisadas = new Set(analisadas.map((c) => c.id));
  const tipoDe = new Map(analisadas.map((c) => [c.id, c.tipo]));
  const diaDe = new Map(analisadas.map((c) => [c.id, diaLisboa(c.dataHora)]));

  const global = zero();
  const porItem = new Map<string, Contagem>();
  const porTipoConta = new Map<string, Contagem>();
  const porDiaConta = new Map<string, Contagem>();

  for (const r of resultados) {
    if (!idsAnalisadas.has(r.chamadaId)) continue;
    somar(global, r);
    const ci = porItem.get(r.item) ?? zero();
    somar(ci, r);
    porItem.set(r.item, ci);
    const tipo = tipoDe.get(r.chamadaId) ?? "";
    const ct = porTipoConta.get(tipo) ?? zero();
    somar(ct, r);
    porTipoConta.set(tipo, ct);
    const dia = diaDe.get(r.chamadaId) ?? "";
    const cd = porDiaConta.get(dia) ?? zero();
    somar(cd, r);
    porDiaConta.set(dia, cd);
  }

  const chamadasPorDia = new Map<string, number>();
  for (const c of analisadas) {
    const d = diaLisboa(c.dataHora);
    chamadasPorDia.set(d, (chamadasPorDia.get(d) ?? 0) + 1);
  }

  const pontos: PontoAgregado[] = [];
  for (const t of GUIAO) {
    for (const s of t.seccoes) {
      for (const pt of s.pontos) {
        const c = porItem.get(pt.id) ?? zero();
        pontos.push({
          item: pt.id,
          tipo: t.id,
          seccao: s.nome,
          validacao: pt.validacao,
          pergunta: pt.pergunta,
          ...c,
          total: c.cumpriu + c.nao + c.rever,
          pct: percentagem(c),
        });
      }
    }
  }

  const conta = (estado: string) => chamadas.filter((c) => c.estado === estado).length;

  return {
    kpis: {
      recebidas: chamadas.length,
      analisadas: analisadas.length,
      descartadas: conta("descartada"),
      curtas: conta("curta"),
      pendentes: conta("pendente"),
      erros: conta("erro"),
      cumprimentoPct: percentagem(global),
      aRever: global.rever,
    },
    porTipo: GUIAO.map((t) => ({
      tipo: t.id,
      nome: t.nome,
      chamadas: analisadas.filter((c) => c.tipo === t.id).length,
      pct: percentagem(porTipoConta.get(t.id) ?? zero()),
    })),
    porDia: [...chamadasPorDia.keys()].sort().map((data) => ({
      data,
      chamadas: chamadasPorDia.get(data) ?? 0,
      pct: percentagem(porDiaConta.get(data) ?? zero()),
    })),
    pontos,
  };
}

/** Os pontos com dados suficientes, do mais fraco para o mais forte. */
export function ordenarPontos(pontos: PontoAgregado[], minimo = 3): PontoAgregado[] {
  return pontos
    .filter((p) => p.pct !== null && p.cumpriu + p.nao >= minimo)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
}

export function nomePonto(item: string): string {
  return PONTOS.get(item)?.validacao ?? item;
}

/**
 * Período em datas de Lisboa (inclusive) → intervalo UTC [de, ate). Usa o meio
 * do dia para descobrir o desvio, o que basta para os dias de mudança de hora.
 */
export function periodoUtc(de: string, ate: string): { de: Date; ate: Date } {
  const inicio = (dia: string): Date => {
    const meioDia = new Date(`${dia}T12:00:00Z`);
    const hLisboa = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" }).format(meioDia),
    );
    const desvioH = hLisboa - 12;
    return new Date(Date.parse(`${dia}T00:00:00Z`) - desvioH * 3_600_000);
  };
  const seguinte = new Date(Date.parse(`${ate}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { de: inicio(de), ate: inicio(seguinte) };
}
