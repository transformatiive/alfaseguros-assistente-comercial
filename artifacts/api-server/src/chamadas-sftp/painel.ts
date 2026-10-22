import type { ChamadaSftp, ChamadaSftpResultado } from "@workspace/db";
import { chamadasDoPeriodo, resultadosDasChamadas } from "../storage/chamadas-sftp-repo.js";
import { agregar, periodoUtc, type Agregado } from "./agregar.js";
import { PONTOS } from "./catalogo.js";
import type { ContextoDestaques } from "./destaques.js";

/** Dados de um período (datas de Lisboa, inclusive), prontos para o painel. */
export interface DadosPeriodo {
  chamadas: ChamadaSftp[];
  resultados: ChamadaSftpResultado[];
  agregado: Agregado;
}

export async function carregarPeriodo(de: string, ate: string): Promise<DadosPeriodo> {
  const chamadas = await chamadasDoPeriodo(periodoUtc(de, ate));
  const resultados = await resultadosDasChamadas(chamadas.filter((c) => c.estado === "analisada").map((c) => c.id));
  return { chamadas, resultados, agregado: agregar(chamadas, resultados) };
}

/** O período de igual duração imediatamente antes. */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const d0 = Date.parse(`${de}T12:00:00Z`);
  const d1 = Date.parse(`${ate}T12:00:00Z`);
  const dias = Math.round((d1 - d0) / 86_400_000) + 1;
  const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { de: dia(d0 - dias * 86_400_000), ate: dia(d0 - 86_400_000) };
}

/** Desfechos, objeções e o efeito de cada ponto na passagem a proposta. */
export function contexto(atual: DadosPeriodo): Omit<ContextoDestaques, "de" | "ate" | "atual" | "anterior"> {
  const analisadas = atual.chamadas.filter((c) => c.estado === "analisada");
  const proposta = new Map(analisadas.map((c) => [c.id, c.desfecho === "proposta"]));

  const desfechos: Record<string, number> = {};
  const objecoes: Record<string, [number, number]> = {};
  for (const c of analisadas) {
    const d = c.desfecho ?? "outro";
    desfechos[d] = (desfechos[d] ?? 0) + 1;
    for (const o of c.objecoes ?? []) {
      const [n, p] = objecoes[o] ?? [0, 0];
      objecoes[o] = [n + 1, p + (c.desfecho === "proposta" ? 1 : 0)];
    }
  }

  const porItem = new Map<string, { com: [number, number]; sem: [number, number] }>();
  for (const r of atual.resultados) {
    if (r.rever || r.estado === "nao_aplicavel" || !proposta.has(r.chamadaId)) continue;
    const e = porItem.get(r.item) ?? { com: [0, 0], sem: [0, 0] };
    const lado = r.estado === "cumprido" ? e.com : e.sem;
    lado[0] += 1;
    if (proposta.get(r.chamadaId)) lado[1] += 1;
    porItem.set(r.item, e);
  }
  const impactoProposta = [...porItem.entries()]
    .filter(([, e]) => e.com[0] >= 3 && e.sem[0] >= 3)
    .map(([item, e]) => ({
      item,
      validacao: PONTOS.get(item)?.validacao ?? item,
      comPct: Math.round((e.com[1] / e.com[0]) * 100),
      semPct: Math.round((e.sem[1] / e.sem[0]) * 100),
      n: e.com[0] + e.sem[0],
    }))
    .sort((a, b) => b.comPct - b.semPct - (a.comPct - a.semPct))
    .slice(0, 8);

  return { desfechos, objecoes, impactoProposta };
}
