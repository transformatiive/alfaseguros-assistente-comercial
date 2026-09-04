/**
 * The panel payloads, mirrored from the server.
 *
 * Hand-written rather than generated: these endpoints are not in
 * `lib/api-spec/openapi.yaml`, so there is nothing to generate from. When they
 * are added to the spec, delete this file and import from `@workspace/api-zod`
 * instead — do not maintain both.
 */

/** A block that could not be built, or that has no data source yet. */
export interface BlocoIndisponivel {
  disponivel: false;
  /** Written for the agent to read. Goes on screen as-is. */
  motivo: string;
}

export type Bloco<T> = T[] | BlocoIndisponivel;

export function estaDisponivel<T>(b: Bloco<T>): b is T[] {
  return Array.isArray(b);
}

/** Which rule decided who owns a missed call. */
export type OrigemAtribuicao = "ticket" | "grupo" | "historico" | "chamada";

export interface Devolucao {
  ids: number[];
  numeroCliente: string;
  tentativas: number;
  primeiraChamada: string;
  ultimaChamada: string;
  contexto: string | null;
  ticketId: string | null;
  atribuicaoOrigem: OrigemAtribuicao | null;
}

export interface TicketEmRisco {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  status: string | null;
  idadeHoras: number;
  criadoEm: string;
  deskUrl: string;
}

export interface FollowUp {
  id: string;
  contact_phone: string | null;
  follow_up_descricao: string;
  follow_up_sla_hours: number;
  linked_ticket_id: string | null;
  product: string | null;
  detected_at: string;
}

export type TipoAcao =
  | "follow_up_pendente"
  | "risco_perda_lead"
  | "desvio_procedimento"
  | "qualidade_critica"
  | "oportunidade_cross_sell"
  | "cotacao_sem_seguimento"
  | "lead_quente_sem_fecho";

export interface Acao {
  id: string;
  tipo: TipoAcao;
  prioridade: "alta" | "media" | "baixa";
  titulo: string;
  /** The call's own sentence — the summary, where it is needed. */
  descricao: string;
  conversationId: number;
  customerPhone: string;
  contactName: string | null;
  runDate: string;
}

export interface Coaching {
  paragraphOverview: string;
  strengths: string[];
  blindSpots: string[];
  closingRateObservations: string;
  coachingRecommendations: string[];
}

export function coachingDisponivel(
  c: Coaching | BlocoIndisponivel | undefined,
): c is Coaching {
  return !!c && !("disponivel" in c);
}

export interface AgentePainel {
  colaborador: { id: number; nome: string; papel: string; equipa: string };
  data: string;
  devolucoes: Bloco<Devolucao>;
  ticketsEmRisco: Bloco<TicketEmRisco>;
  followUps: Bloco<FollowUp>;
  acoes: Bloco<Acao>;
  coaching: Coaching | BlocoIndisponivel;
  /** Always unavailable today — scheduling lives in the CRM, which is not connected. */
  agendamentos: BlocoIndisponivel;
  atualizadoEm: string;
}

export interface LinhaAgente {
  colaboradorId: number;
  nome: string;
  devolucoes: number;
  ticketsEmRisco: number;
  followUps: number;
  cargaPonderada: number;
  jaContadasComoTicket: number;
  indisponiveis: string[];
}

export interface SupervisorPainel {
  data: string;
  totais: { devolucoes: number; ticketsEmRisco: number; followUps: number };
  agentes: LinhaAgente[];
  naoAtribuidas: Bloco<Devolucao>;
  sugestao: {
    de: { colaboradorId: number; nome: string } | null;
    para: { colaboradorId: number; nome: string } | null;
    razao: string;
  };
  regra: {
    pesos: { devolucoes: number; ticketsEmRisco: number; followUps: number };
    limiarSobrecarga: number;
  };
  atualizadoEm: string;
}
