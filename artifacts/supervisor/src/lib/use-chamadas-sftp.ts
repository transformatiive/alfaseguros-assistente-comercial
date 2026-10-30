import { useQuery } from "@tanstack/react-query";

/** Tipos das respostas de /api/chamadas-sftp/* (Análise de Chamadas · Campanha Vida, SolidNetworks). */

export type TipoChamada = "primeiro" | "seguinte" | "proposta" | "pos_venda";

export const NOMES_TIPO: Record<TipoChamada, string> = {
  primeiro: "1.º Telefonema",
  seguinte: "Telefonemas seguintes",
  proposta: "Telefonemas proposta",
  pos_venda: "Pós-venda",
};

export const TIPOS: TipoChamada[] = ["primeiro", "seguinte", "proposta", "pos_venda"];

export const NOMES_DESFECHO: Record<string, string> = {
  proposta: "Avançou para proposta",
  novo_contacto: "Novo contacto marcado",
  recusou: "Recusou",
  outro: "Outro",
};

export const NOMES_OBJECAO: Record<string, string> = {
  banco: "Banco",
  tempo: "Falta de tempo",
  email: "Não viu o email",
  preco: "Preço",
  saude: "Saúde",
  outra: "Outra",
};

export interface PontoAgregado {
  item: string;
  tipo: TipoChamada;
  seccao: string;
  validacao: string;
  pergunta: string;
  cumpriu: number;
  nao: number;
  rever: number;
  naoAplicavel: number;
  total: number;
  pct: number | null;
}

export interface Destaque {
  etiqueta: string;
  titulo: string;
  texto: string;
  item?: string | null;
}

export interface ResumoResponse {
  configurado: boolean;
  de: string;
  ate: string;
  ultimaAnalise: string | null;
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
  anterior: {
    de: string;
    ate: string;
    analisadas: number;
    cumprimentoPct: number | null;
    pontos: Record<string, number | null>;
  };
  destaques: {
    periodoDe: string;
    periodoAte: string;
    geradoEm: string;
    destaques: Destaque[];
    resumoPorTipo: Record<string, string>;
  } | null;
}

export interface ChamadaLinha {
  id: number;
  dataHora: string;
  duracaoS: number | null;
  estado: string;
  colaborador: string;
  tipo: TipoChamada | null;
  resumo: string | null;
  desfecho: string | null;
  objecoes: string[];
  motivoDescarte: string | null;
  telefone: string | null;
  ficheiro: string;
  cumprimentoPct: number | null;
  pontosRever: number;
  item: { estado: string; rever: boolean; confianca: number; evidencia: string | null } | null;
}

export interface ChamadaDetalhe extends Omit<ChamadaLinha, "cumprimentoPct" | "pontosRever" | "item"> {
  modelo: string | null;
  resultados: Array<{
    item: string;
    seccao: string;
    validacao: string;
    pergunta: string;
    estado: string;
    rever: boolean;
    confianca: number;
    evidencia: string | null;
  }>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`Pedido falhou: HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function useResumo(de: string, ate: string, ativo = true) {
  return useQuery({
    queryKey: ["chamadas-sftp-resumo", de, ate],
    queryFn: () => getJson<ResumoResponse>(`/api/chamadas-sftp/resumo?de=${de}&ate=${ate}`),
    enabled: ativo && Boolean(de && ate && de <= ate),
    placeholderData: (prev) => prev,
  });
}

export interface FiltroChamadas {
  tipo?: TipoChamada | null;
  item?: string | null;
  res?: "cumpriu" | "nao" | "rever" | null;
  estado?: "analisada" | "todas";
}

export function useChamadas(de: string, ate: string, f: FiltroChamadas, ativo = true) {
  const q = new URLSearchParams({ de, ate });
  if (f.tipo) q.set("tipo", f.tipo);
  if (f.item) q.set("item", f.item);
  if (f.res) q.set("res", f.res);
  if (f.estado) q.set("estado", f.estado);
  return useQuery({
    queryKey: ["chamadas-sftp-lista", q.toString()],
    queryFn: () => getJson<{ total: number; chamadas: ChamadaLinha[] }>(`/api/chamadas-sftp/chamadas?${q}`),
    enabled: ativo && Boolean(de && ate),
  });
}

export function useChamada(id: number | null) {
  return useQuery({
    queryKey: ["chamadas-sftp-chamada", id],
    queryFn: () => getJson<ChamadaDetalhe>(`/api/chamadas-sftp/chamadas/${id}`),
    enabled: id !== null,
  });
}

export function useTranscricao(id: number | null, ativo: boolean) {
  return useQuery({
    queryKey: ["chamadas-sftp-transcricao", id],
    queryFn: () => getJson<{ linhas: string[] }>(`/api/chamadas-sftp/chamadas/${id}/transcricao`),
    enabled: ativo && id !== null,
    staleTime: Infinity,
  });
}

export function urlAudio(id: number): string {
  return `/api/chamadas-sftp/chamadas/${id}/audio`;
}

/**
 * "Exportar Excel": CSV com separador ";" e BOM UTF-8, que o Excel em
 * português abre direto com acentos e colunas certas.
 */
export function exportarExcel(nome: string, cabecalho: string[], linhas: Array<Array<string | number | null>>): void {
  const celula = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
