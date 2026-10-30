import { z } from "zod";
import { DESFECHOS, OBJECOES } from "./analisar.js";
import { TIPOS, type TipoChamada } from "./catalogo.js";

/**
 * Migração das análises que o portal SFTP fez entre 23/10 e o dia em que a
 * análise passou para o Supervisor (decisão do Nuno, 30/10/2026).
 *
 * O portal guardava tudo em `/data/analise/chamadas.json`, uma entrada por
 * gravação, com o mesmo guião e o mesmo modelo. Este ficheiro só lê esse
 * formato e diz o que gravar; quem grava é o repo.
 *
 * Nada é enviado de novo ao modelo: a análise que a Soraia já viu é a que fica.
 */

const ESTADOS = ["pendente", "curta", "analisada", "descartada", "erro"] as const;
const ESTADOS_PONTO = ["cumprido", "nao_cumprido", "nao_aplicavel"] as const;

const resultadoPortalSchema = z.object({
  item: z.string().min(1),
  estado: z.enum(ESTADOS_PONTO),
  confianca: z.coerce.number().min(0).max(1).catch(0),
  rever: z.boolean().catch(false),
  evidencia: z.string().nullish().catch(null),
});

const chamadaPortalSchema = z.object({
  ficheiro: z.string().min(1),
  dataHora: z.number(), // ms desde 1970
  telefone: z.string().nullish(),
  tamanhoBytes: z.number().nullish(),
  duracaoS: z.number().nullish(),
  estado: z.enum(ESTADOS),
  colaborador: z.string().nullish(),
  tipo: z.string().nullish(),
  resumo: z.string().nullish(),
  desfecho: z.string().nullish(),
  objecoes: z.array(z.string()).nullish(),
  motivoDescarte: z.string().nullish(),
  erro: z.string().nullish(),
  modelo: z.string().nullish(),
  custoUsd: z.number().nullish(),
  analisadaEm: z.number().nullish(),
  resultados: z.array(z.unknown()).nullish(),
});

export const exportPortalSchema = z.object({
  chamadas: z.array(z.unknown()),
  destaques: z
    .object({ periodoDe: z.string(), periodoAte: z.string(), geradoEm: z.number().nullish(), modelo: z.string().nullish() })
    .passthrough()
    .nullish(),
});

export interface ChamadaImportada {
  linha: {
    ficheiro: string;
    dataHora: Date;
    telefone: string | null;
    tamanhoBytes: number;
    duracaoS: number | null;
    estado: (typeof ESTADOS)[number];
    colaborador: string;
    tipo: TipoChamada | null;
    resumo: string | null;
    desfecho: string | null;
    objecoes: string[];
    motivoDescarte: string | null;
    erro: string | null;
    modelo: string | null;
    custoUsd: number | null;
    analisadaEm: Date | null;
  };
  resultados: { item: string; estado: (typeof ESTADOS_PONTO)[number]; confianca: number; rever: boolean; evidencia: string | null }[];
}

/**
 * One portal entry → what to store, or null when the entry is unusable.
 * An "analisada" entry without a valid call type cannot be shown in the
 * guião view, so it comes back as "erro" and the Supervisor will analyse it
 * again once its own analysis is on.
 */
export function converterChamadaPortal(bruta: unknown): ChamadaImportada | null {
  const p = chamadaPortalSchema.safeParse(bruta);
  if (!p.success) return null;
  const c = p.data;
  const dataHora = new Date(c.dataHora);
  if (Number.isNaN(dataHora.getTime())) return null;

  const tipo = (TIPOS as readonly string[]).includes(c.tipo ?? "") ? (c.tipo as TipoChamada) : null;
  let estado = c.estado;
  let erro = c.erro ?? null;
  if (estado === "analisada" && !tipo) {
    estado = "erro";
    erro = "Migrada do portal sem tipo de chamada válido";
  }
  const resultados =
    estado === "analisada"
      ? (c.resultados ?? []).flatMap((r) => {
          const v = resultadoPortalSchema.safeParse(r);
          return v.success ? [{ ...v.data, evidencia: v.data.evidencia || null }] : [];
        })
      : [];

  return {
    linha: {
      ficheiro: c.ficheiro,
      dataHora,
      telefone: c.telefone ?? null,
      tamanhoBytes: Math.max(0, Math.round(c.tamanhoBytes ?? 0)),
      duracaoS: c.duracaoS ?? null,
      estado,
      colaborador: c.colaborador || "Colaborador Vida",
      tipo: estado === "analisada" ? tipo : null,
      resumo: c.resumo ?? null,
      desfecho: c.desfecho && (DESFECHOS as readonly string[]).includes(c.desfecho) ? c.desfecho : c.desfecho ? "outro" : null,
      objecoes: (c.objecoes ?? []).map((o) => ((OBJECOES as readonly string[]).includes(o) ? o : "outra")),
      motivoDescarte: c.motivoDescarte ?? null,
      erro,
      modelo: c.modelo ?? null,
      custoUsd: c.custoUsd ?? null,
      analisadaEm: c.analisadaEm ? new Date(c.analisadaEm) : null,
    },
    resultados,
  };
}

/** States the portal finished: an import never overwrites these in the Supervisor. */
export const ESTADOS_FINAIS = ["analisada", "descartada"] as const;
