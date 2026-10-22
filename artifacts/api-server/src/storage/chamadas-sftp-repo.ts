import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  chamadasSftpTable,
  chamadasSftpResultadosTable,
  chamadasSftpDestaquesTable,
  type ChamadaSftp,
  type ChamadaSftpResultado,
} from "@workspace/db";
import type { ResultadoPonto } from "../chamadas-sftp/analisar.js";
import type { TipoChamada } from "../chamadas-sftp/catalogo.js";

/**
 * Acesso à base de dados da Análise de Chamadas Vida (gravações do SFTP). Como
 * em `repo.ts`, é o único sítio que toca nestas tabelas.
 */

export async function ficheirosRegistados(): Promise<Map<string, { id: number; estado: ChamadaSftp["estado"] }>> {
  const rows = await db
    .select({ id: chamadasSftpTable.id, ficheiro: chamadasSftpTable.ficheiro, estado: chamadasSftpTable.estado })
    .from(chamadasSftpTable);
  return new Map(rows.map((r) => [r.ficheiro, { id: r.id, estado: r.estado }]));
}

export async function registarGravacoes(
  novas: Array<{ ficheiro: string; dataHora: Date; telefone: string | null; tamanhoBytes: number; estado: "pendente" | "curta" }>,
): Promise<void> {
  if (novas.length === 0) return;
  for (let i = 0; i < novas.length; i += 500) {
    await db
      .insert(chamadasSftpTable)
      .values(novas.slice(i, i + 500))
      .onConflictDoNothing({ target: chamadasSftpTable.ficheiro });
  }
}

export async function marcarDescartada(
  id: number,
  dados: { duracaoS: number; motivo: string; resumo: string; modelo: string | null; custoUsd: number },
): Promise<void> {
  await db
    .update(chamadasSftpTable)
    .set({
      estado: "descartada",
      duracaoS: dados.duracaoS,
      motivoDescarte: dados.motivo,
      resumo: dados.resumo || null,
      modelo: dados.modelo,
      custoUsd: dados.custoUsd,
      erro: null,
      analisadaEm: new Date(),
    })
    .where(eq(chamadasSftpTable.id, id));
}

export async function marcarErro(id: number, erro: string, duracaoS: number | null): Promise<void> {
  await db
    .update(chamadasSftpTable)
    .set({ estado: "erro", erro, duracaoS })
    .where(eq(chamadasSftpTable.id, id));
}

export async function guardarAnalise(
  id: number,
  dados: {
    duracaoS: number;
    tipo: TipoChamada;
    resumo: string;
    desfecho: string;
    objecoes: string[];
    resultados: ResultadoPonto[];
    modelo: string;
    custoUsd: number;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(chamadasSftpResultadosTable).where(eq(chamadasSftpResultadosTable.chamadaId, id));
    if (dados.resultados.length > 0) {
      await tx.insert(chamadasSftpResultadosTable).values(
        dados.resultados.map((r) => ({
          chamadaId: id,
          item: r.item,
          estado: r.estado,
          confianca: r.confianca,
          rever: r.rever,
          evidencia: r.evidencia || null,
        })),
      );
    }
    await tx
      .update(chamadasSftpTable)
      .set({
        estado: "analisada",
        duracaoS: dados.duracaoS,
        tipo: dados.tipo,
        resumo: dados.resumo,
        desfecho: dados.desfecho,
        objecoes: dados.objecoes,
        motivoDescarte: null,
        erro: null,
        modelo: dados.modelo,
        custoUsd: dados.custoUsd,
        analisadaEm: new Date(),
      })
      .where(eq(chamadasSftpTable.id, id));
  });
}

/** Volta a pôr como pendentes as gravações que já têm transcrição mas falharam. */
export async function chamadasPorAnalisar(ficheiros: string[]): Promise<ChamadaSftp[]> {
  if (ficheiros.length === 0) return [];
  return db
    .select()
    .from(chamadasSftpTable)
    .where(and(inArray(chamadasSftpTable.ficheiro, ficheiros), inArray(chamadasSftpTable.estado, ["pendente", "erro"])));
}

export interface PeriodoUtc {
  de: Date; // inclusive
  ate: Date; // exclusive
}

export async function chamadasDoPeriodo(p: PeriodoUtc): Promise<ChamadaSftp[]> {
  return db
    .select()
    .from(chamadasSftpTable)
    .where(and(gte(chamadasSftpTable.dataHora, p.de), lt(chamadasSftpTable.dataHora, p.ate)))
    .orderBy(desc(chamadasSftpTable.dataHora));
}

export async function resultadosDasChamadas(ids: number[]): Promise<ChamadaSftpResultado[]> {
  if (ids.length === 0) return [];
  const out: ChamadaSftpResultado[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    out.push(
      ...(await db
        .select()
        .from(chamadasSftpResultadosTable)
        .where(inArray(chamadasSftpResultadosTable.chamadaId, ids.slice(i, i + 1000)))),
    );
  }
  return out;
}

export async function chamadaPorId(id: number): Promise<ChamadaSftp | null> {
  const [row] = await db.select().from(chamadasSftpTable).where(eq(chamadasSftpTable.id, id)).limit(1);
  return row ?? null;
}

export async function ultimaAnalise(): Promise<Date | null> {
  const [row] = await db
    .select({ m: sql<Date | null>`max(${chamadasSftpTable.analisadaEm})` })
    .from(chamadasSftpTable);
  return row?.m ? new Date(row.m) : null;
}

export async function guardarDestaques(dados: {
  periodoDe: string;
  periodoAte: string;
  conteudo: unknown;
  modelo: string;
}): Promise<void> {
  await db.insert(chamadasSftpDestaquesTable).values(dados);
}

export async function destaquesMaisRecentes(): Promise<{
  periodoDe: string;
  periodoAte: string;
  conteudo: unknown;
  geradoEm: Date;
} | null> {
  const [row] = await db
    .select()
    .from(chamadasSftpDestaquesTable)
    .orderBy(desc(chamadasSftpDestaquesTable.geradoEm))
    .limit(1);
  return row ?? null;
}
