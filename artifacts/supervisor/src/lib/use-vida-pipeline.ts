import { useQuery } from "@tanstack/react-query";

/** Respostas de /api/vida/pipeline/* (ver api-server/src/routes/vida-pipeline.ts). */

export interface PessoaNocrm {
  userId: number;
  nome: string;
  email: string | null;
  ativo: boolean;
  naEquipa: boolean;
}

export interface Sincronizacao {
  ultimaCorridaEm: string | null;
  pedidosNoDia: number;
  dia: string | null;
  ultimoResultado: { ok?: boolean; motivo?: string; leadsPorLer?: number } | null;
}

export interface PessoaResumo {
  userId: number | null;
  carteira: number;
  previsto: number;
  feito: number;
  tentou: number;
  naoFeito: number;
  atrasadas: number;
  vendas: number;
  premio: number;
  conversas: number;
  tentativas: number;
  alertas: number;
}

export interface ResumoVida {
  de: string;
  ate: string;
  hoje: string;
  leadsNovas: number;
  primeiroContacto: { noPrazo: number; avaliadas: number };
  simulacoes: number;
  propostas: number;
  vendas: number;
  premio: number;
  perdidas: number;
  previsto: number;
  feito: number;
  atrasadas: number;
  totalAlertas: number;
  pessoas: PessoaResumo[];
  dias: { dia: string; previsto: number; feito: number; futuro: boolean }[];
  funil: { passo: string; total: number; paradas: number }[];
  motivosPerda: { motivo: string; n: number }[];
  origens: { origem: string; fechadas: number; ganhas: number }[];
  equipa: PessoaNocrm[];
  colaboradoresSemNocrm: { nome: string; email: string | null }[];
  prazos: Record<string, number>;
  sincronizacao: Sincronizacao;
}

export type EstadoAgenda = "feito" | "tentou" | "nao_feito" | "mais_logo";

export interface AlertaVida {
  tipo: string;
  nome: string;
  leadId: number;
  titulo: string;
  passo: string | null;
  userId: number | null;
  pessoa?: string | null;
  desde: string;
  fazer: string;
}

export interface ColaboradorVida {
  pessoa: PessoaNocrm;
  dia: string;
  hoje: string;
  carteira: number;
  funil: { passo: string; total: number }[];
  agenda: { dia: string; leadId: number; titulo: string; hora: string | null; passo: string | null; estado: EstadoAgenda }[];
  dias: { dia: string; previsto: number; feito: number; tentou: number }[];
  atrasadas: { leadId: number; titulo: string; passo: string | null; proximaAcaoDia: string | null; proximaAcaoHora: string | null }[];
  paradas: { leadId: number; titulo: string; passo: string | null; dias: number; prazo: number | null }[];
  chamadas: {
    id: string;
    leadId: number;
    titulo: string;
    ocorreuEm: string;
    duracaoSeg: number | null;
    conversa: boolean;
    tentativa: boolean;
    resumo: string | null;
    gravacaoUrl: string | null;
  }[];
  alertas: AlertaVida[];
}

export interface AlertasVida {
  hoje: string;
  alertas: AlertaVida[];
  porTipo: Record<string, number>;
  tipos: Record<string, string>;
  sincronizacao: Sincronizacao;
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

export function useResumoVida(de: string, ate: string) {
  return useQuery({
    queryKey: ["vida-pipeline-resumo", de, ate],
    queryFn: () => getJson<ResumoVida>(`/api/vida/pipeline/resumo?de=${de}&ate=${ate}`),
    enabled: Boolean(de && ate),
  });
}

export function useColaboradorVida(userId: number | null, dia: string) {
  return useQuery({
    queryKey: ["vida-pipeline-colaborador", userId, dia],
    queryFn: () => getJson<ColaboradorVida>(`/api/vida/pipeline/colaborador/${userId}?dia=${dia}`),
    enabled: userId != null && Boolean(dia),
  });
}

export function useAlertasVida() {
  return useQuery({
    queryKey: ["vida-pipeline-alertas"],
    queryFn: () => getJson<AlertasVida>("/api/vida/pipeline/alertas"),
  });
}

/** Link para a lead no noCRM. */
export function linkLead(leadId: number): string {
  return `https://alfa-seguros.nocrm.io/leads/${leadId}`;
}
