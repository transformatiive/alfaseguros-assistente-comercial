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

/** What a task asks of the agent. Drives its group, its icon and its order. */
export type CategoriaTarefa =
  | "devolver_chamada"
  | "enviar_simulacao"
  | "cumprir_compromisso"
  | "retomar_conversa"
  | "espera_alfa"
  | "espera_cliente";

/** How to reach the person. At least one of the three is always present. */
export interface Contacto {
  nome: string | null;
  telefone: string | null;
  email: string | null;
}

/**
 * One thing to do. Every task answers the same four questions — what
 * (`titulo`), why (`porque`), with whom (`contacto`), by when (`prazo`) —
 * whichever of the four sources it came from.
 */
export interface Tarefa {
  id: string;
  categoria: CategoriaTarefa;
  titulo: string;
  porque: string | null;
  contacto: Contacto;
  prazo: string | null;
  esperaHoras: number | null;
  /** Desk status, verbatim, on the rows that come from a ticket. */
  estado: string | null;
  ticketId: string | null;
  deskUrl: string | null;
  prioridade: "alta" | "media" | "baixa";
  /** Only on `devolver_chamada`: the call ids the "Devolvida" button closes. */
  devolucaoIds: number[] | null;
  /** Only on `devolver_chamada`: which rule decided this call is this agent's. */
  atribuicaoOrigem: OrigemAtribuicao | null;
}

/** Ordered by whose time is being burned, not by size. Mirrors the server. */
export const ORDEM_CATEGORIAS: readonly CategoriaTarefa[] = [
  "devolver_chamada",
  "enviar_simulacao",
  "cumprir_compromisso",
  "espera_alfa",
  "retomar_conversa",
  "espera_cliente",
];

const PESO_PRIORIDADE: Record<Tarefa["prioridade"], number> = { alta: 0, media: 1, baixa: 2 };

export function agruparTarefas(
  tarefas: readonly Tarefa[],
): Array<{ categoria: CategoriaTarefa; tarefas: Tarefa[] }> {
  const porCategoria = new Map<CategoriaTarefa, Tarefa[]>();
  for (const t of tarefas) {
    porCategoria.set(t.categoria, [...(porCategoria.get(t.categoria) ?? []), t]);
  }
  return ORDEM_CATEGORIAS.flatMap((categoria) => {
    const lista = porCategoria.get(categoria);
    if (!lista || lista.length === 0) return [];
    return [
      {
        categoria,
        tarefas: [...lista].sort(
          (a, b) =>
            PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] ||
            (b.esperaHoras ?? 0) - (a.esperaHoras ?? 0),
        ),
      },
    ];
  });
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
  /** The four blocks above, regrouped by what each row asks of the agent. */
  tarefas: Tarefa[];
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
