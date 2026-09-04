/**
 * The seven rules that turn a day's conversation analyses into things somebody
 * has to do.
 *
 * Lifted verbatim out of `routes/actions.ts`, which now calls this instead of
 * carrying its own copy. The supervisor's "Ações do Dia" and the agent's panel
 * must never disagree about what counts as an action — two implementations of
 * the same seven rules is two truths waiting to drift apart.
 *
 * The interesting rules are the last two. Most of these fire on something that
 * *happened*; `cotacao_sem_seguimento` and `lead_quente_sem_fecho` fire on
 * something that **did not**. A quote that ended with no next step is invisible
 * in every other view precisely because nothing was recorded — which is exactly
 * why it is worth surfacing.
 *
 * Pure: no database, no network. The caller supplies the rows.
 */

export type TipoAcao =
  | "follow_up_pendente"
  | "risco_perda_lead"
  | "desvio_procedimento"
  | "qualidade_critica"
  | "oportunidade_cross_sell"
  | "cotacao_sem_seguimento"
  | "lead_quente_sem_fecho";

export type Prioridade = "alta" | "media" | "baixa";

export interface Acao {
  id: string;
  tipo: TipoAcao;
  prioridade: Prioridade;
  titulo: string;
  /**
   * One sentence from the call's own narrative or the supervisor feedback —
   * the call summary, in the place where it is needed. Without it the row is a
   * label; with it the agent knows what the conversation was about before
   * opening anything.
   */
  descricao: string;
  conversationId: number;
  agentId: string | null;
  agentName: string | null;
  customerPhone: string;
  contactName: string | null;
  runDate: string;
}

/** The conversation row shape these rules need. */
export interface ConversaParaAcoes {
  id: number;
  runDate: string;
  agentId: string | null;
  agentName: string | null;
  customerPhone: string;
  analysisJson: unknown;
}

export const ORDEM_PRIORIDADE: Record<Prioridade, number> = {
  alta: 0,
  media: 1,
  baixa: 2,
};

/**
 * First complete sentence, so a card's description never stops mid-thought.
 * Falls back to the whole text when no boundary is found in 300 characters.
 */
export function primeiraFrase(texto: string): string {
  const m = texto.match(/^.{10,300}?[.!?](?:\s|$)/s);
  return m ? m[0].trim() : texto;
}

export function derivarAcoes(
  conversas: readonly ConversaParaAcoes[],
  /**
   * Resolves a customer's name from their phone. Passed as a function rather
   * than a map so this module never has to know that the lookup happens by
   * phone fingerprint — that is the caller's concern, and both callers already
   * have the tickets loaded.
   */
  nomeDe?: (telefone: string) => string | null,
): Acao[] {
  const items: Acao[] = [];

  for (const conv of conversas) {
    const a = (conv.analysisJson ?? null) as Record<string, unknown> | null;
    if (!a) continue;

    const base = {
      conversationId: conv.id,
      agentId: conv.agentId,
      agentName: conv.agentName,
      customerPhone: conv.customerPhone,
      contactName: nomeDe?.(conv.customerPhone) ?? null,
      runDate: conv.runDate,
    };

    const categoria = typeof a.categoria === "string" ? a.categoria.trim() : "";
    const followUpNecessario = a.followUpNecessario === true;
    const narrativa = typeof a.narrativaConversa === "string" ? a.narrativaConversa.trim() : "";
    const qualidade = typeof a.qualidadeGlobal === "number" ? a.qualidadeGlobal : null;

    // 1. Follow-up pendente — a promise made on the call, not yet kept.
    if (followUpNecessario) {
      const d =
        typeof a.followUpDescricao === "string" && a.followUpDescricao.trim()
          ? primeiraFrase(a.followUpDescricao)
          : "Follow-up necessário — sem descrição registada.";
      items.push({
        ...base,
        id: `${conv.id}-follow_up`,
        tipo: "follow_up_pendente",
        prioridade: "alta",
        titulo: "Follow-up pendente",
        descricao: d,
      });
    }

    // 2. Risco de perda. For a claim the person is already a customer, so the
    // risk is churn, not a lost lead — only surfaced when it is high.
    const risco = a.riscoPerdaLead as string | undefined;
    const ehSinistro = categoria === "Sinistro";
    if (risco === "alto" || (risco === "medio" && !ehSinistro)) {
      items.push({
        ...base,
        id: `${conv.id}-risco`,
        tipo: "risco_perda_lead",
        prioridade: risco === "alto" ? "alta" : "media",
        titulo: ehSinistro
          ? risco === "alto"
            ? "Risco alto de perda de cliente"
            : "Risco médio de perda de cliente"
          : risco === "alto"
            ? "Risco alto de perda de lead"
            : "Risco médio de perda de lead",
        descricao: narrativa
          ? primeiraFrase(narrativa)
          : ehSinistro
            ? "Atendimento de sinistro com potencial insatisfação — risco de o cliente mudar de seguradora."
            : "Potencial perda de lead identificada pela análise.",
      });
    }

    // 3. Desvios de procedimento — high and medium only; low severity would
    // drown the list.
    const desvios = Array.isArray(a.desviosProcedimento) ? a.desviosProcedimento : [];
    desvios.forEach((raw, i) => {
      const d = raw as Record<string, unknown>;
      const sev = d.severidade as string | undefined;
      if (sev !== "alta" && sev !== "media") return;
      items.push({
        ...base,
        id: `${conv.id}-desvio-${i}`,
        tipo: "desvio_procedimento",
        prioridade: sev === "alta" ? "alta" : "media",
        titulo: typeof d.titulo === "string" ? d.titulo : "Desvio de procedimento",
        descricao: typeof d.detalhe === "string" ? primeiraFrase(d.detalhe) : "",
      });
    });

    // 4. Qualidade crítica.
    if (qualidade !== null && qualidade <= 2) {
      items.push({
        ...base,
        id: `${conv.id}-qualidade`,
        tipo: "qualidade_critica",
        prioridade: qualidade <= 1 ? "alta" : "media",
        titulo: `Qualidade crítica — ${qualidade}/5`,
        descricao:
          typeof a.feedbackSupervisor === "string" && a.feedbackSupervisor.trim()
            ? primeiraFrase(a.feedbackSupervisor)
            : "Chamada com qualidade muito abaixo do esperado. Recomenda-se ouvir a gravação.",
      });
    }

    // 5. Cross-sell — only on a call that went well, so poor calls do not
    // pollute the opportunity list.
    const sugestao =
      typeof a.sugestaoEspecialista === "string" ? a.sugestaoEspecialista.trim() : "";
    if (sugestao && qualidade !== null && qualidade >= 3) {
      items.push({
        ...base,
        id: `${conv.id}-cross_sell`,
        tipo: "oportunidade_cross_sell",
        prioridade: "baixa",
        titulo: "Oportunidade de cross-sell identificada",
        descricao: primeiraFrase(sugestao),
      });
    }

    // 6. A quote that ended with nothing scheduled.
    if (categoria === "Cotação" && !followUpNecessario) {
      items.push({
        ...base,
        id: `${conv.id}-cotacao_sem_seguimento`,
        tipo: "cotacao_sem_seguimento",
        prioridade: "media",
        titulo: "Cotação sem seguimento marcado",
        descricao: narrativa
          ? primeiraFrase(narrativa)
          : "Chamada de cotação encerrada sem follow-up registado. Risco de o lead esfriar.",
      });
    }

    // 7. Everything went right and still nobody agreed a next step.
    const arco = typeof a.arcoConversa === "string" ? a.arcoConversa : "";
    if (
      a.riscoPerdaLead === "baixo" &&
      qualidade !== null &&
      qualidade >= 4 &&
      /quente/i.test(arco) &&
      !followUpNecessario
    ) {
      items.push({
        ...base,
        id: `${conv.id}-lead_quente`,
        tipo: "lead_quente_sem_fecho",
        prioridade: "media",
        titulo: "Lead quente — fecho não aproveitado",
        descricao: narrativa
          ? primeiraFrase(narrativa)
          : `Arco: ${arco}. Chamada de alta qualidade com cliente receptivo, sem próximo passo definido.`,
      });
    }
  }

  items.sort((x, y) => {
    const p = ORDEM_PRIORIDADE[x.prioridade] - ORDEM_PRIORIDADE[y.prioridade];
    if (p !== 0) return p;
    return (x.agentName ?? "").localeCompare(y.agentName ?? "", "pt");
  });

  return items;
}
