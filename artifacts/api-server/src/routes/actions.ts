import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";
import { ListConversationsParams } from "@workspace/api-zod";

const router: IRouter = Router();

type Prioridade = "alta" | "media" | "baixa";
type Tipo =
  | "follow_up_pendente"
  | "risco_perda_lead"
  | "desvio_procedimento"
  | "qualidade_critica"
  | "oportunidade_cross_sell"
  | "cotacao_sem_seguimento"
  | "lead_quente_sem_fecho";

interface ActionItem {
  id: string;
  tipo: Tipo;
  prioridade: Prioridade;
  titulo: string;
  descricao: string;
  conversationId: number;
  agentName: string | null;
  customerPhone: string;
  runDate: string;
}

const PRIORITY_ORDER: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

/**
 * Extracts the first complete sentence from a text block (ending at . ! or ?)
 * so action card descriptions don't cut off mid-sentence.
 * Falls back to the full text if no sentence boundary is found within 300 chars.
 */
function firstSentence(text: string): string {
  const match = text.match(/^.{10,300}?[.!?](?:\s|$)/s);
  return match ? match[0].trim() : text;
}

router.get("/actions/:date", async (req, res): Promise<void> => {
  const params = ListConversationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { date } = params.data;

  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.runDate, date));

  const items: ActionItem[] = [];

  for (const conv of conversations) {
    const a = (conv.analysisJson ?? null) as Record<string, unknown> | null;
    if (!a) continue;

    const agentName = conv.agentName ?? null;
    const customerPhone = conv.customerPhone;
    const conversationId = conv.id;
    const runDate = conv.runDate;
    const categoria = typeof a.categoria === "string" ? a.categoria.trim() : "";
    const followUpNecessario = a.followUpNecessario === true;

    // 1. Follow-up pendente
    if (a.followUpNecessario === true) {
      const descricao =
        typeof a.followUpDescricao === "string" && a.followUpDescricao.trim()
          ? firstSentence(a.followUpDescricao)
          : "Follow-up necessário — sem descrição registada.";
      items.push({
        id: `${conversationId}-follow_up`,
        tipo: "follow_up_pendente",
        prioridade: "alta",
        titulo: "Follow-up pendente",
        descricao,
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 2. Risco de perda de lead / cliente
    // Para sinistros, a pessoa já é cliente — o risco é de churn, não de perda de lead.
    // Só surfacia se a categoria NÃO for Sinistro, ou se for sinistro mas com risco alto
    // (insatisfação grave pode fazer o cliente mudar de seguradora).
    const risco = a.riscoPerdaLead as string | undefined;
    const ehSinistro = categoria === "Sinistro";
    if (risco === "alto" || (risco === "medio" && !ehSinistro)) {
      const tituloBase = ehSinistro
        ? risco === "alto" ? "Risco alto de perda de cliente" : "Risco médio de perda de cliente"
        : risco === "alto" ? "Risco alto de perda de lead" : "Risco médio de perda de lead";
      const descricaoFallback = ehSinistro
        ? "Atendimento de sinistro com potencial insatisfação — risco de o cliente mudar de seguradora."
        : "Potencial perda de lead identificada pela análise.";
      items.push({
        id: `${conversationId}-risco`,
        tipo: "risco_perda_lead",
        prioridade: risco === "alto" ? "alta" : "media",
        titulo: tituloBase,
        descricao:
          typeof a.narrativaConversa === "string" && a.narrativaConversa.trim()
            ? firstSentence(a.narrativaConversa)
            : descricaoFallback,
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 3. Desvios de procedimento (alta e media only)
    const desvios = Array.isArray(a.desviosProcedimento) ? a.desviosProcedimento : [];
    for (let i = 0; i < desvios.length; i++) {
      const d = desvios[i] as Record<string, unknown>;
      const sev = d.severidade as string | undefined;
      if (sev !== "alta" && sev !== "media") continue;
      items.push({
        id: `${conversationId}-desvio-${i}`,
        tipo: "desvio_procedimento",
        prioridade: sev === "alta" ? "alta" : "media",
        titulo: typeof d.titulo === "string" ? d.titulo : "Desvio de procedimento",
        descricao: typeof d.detalhe === "string" ? firstSentence(d.detalhe) : "",
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 4. Qualidade crítica (qualidadeGlobal <= 2)
    const qualidade = typeof a.qualidadeGlobal === "number" ? a.qualidadeGlobal : null;
    if (qualidade !== null && qualidade <= 2) {
      items.push({
        id: `${conversationId}-qualidade`,
        tipo: "qualidade_critica",
        prioridade: qualidade <= 1 ? "alta" : "media",
        titulo: `Qualidade crítica — ${qualidade}/5`,
        descricao:
          typeof a.feedbackSupervisor === "string" && a.feedbackSupervisor.trim()
            ? firstSentence(a.feedbackSupervisor)
            : "Chamada com qualidade muito abaixo do esperado. Recomenda-se ouvir a gravação.",
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 5. Oportunidade de cross-sell identificada mas não explorada
    // Only surfaces when quality is acceptable (>= 3) so poor calls don't pollute this category
    const sugestao = typeof a.sugestaoEspecialista === "string" ? a.sugestaoEspecialista.trim() : "";
    if (sugestao && qualidade !== null && qualidade >= 3) {
      items.push({
        id: `${conversationId}-cross_sell`,
        tipo: "oportunidade_cross_sell",
        prioridade: "baixa",
        titulo: "Oportunidade de cross-sell identificada",
        descricao: firstSentence(sugestao),
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 6. Cotação sem seguimento
    // Pedido de cotação terminado sem follow-up marcado — falha frequente no fecho
    if (categoria === "Cotação" && !followUpNecessario) {
      items.push({
        id: `${conversationId}-cotacao_sem_seguimento`,
        tipo: "cotacao_sem_seguimento",
        prioridade: "media",
        titulo: "Cotação sem seguimento marcado",
        descricao:
          typeof a.narrativaConversa === "string" && a.narrativaConversa.trim()
            ? firstSentence(a.narrativaConversa)
            : "Chamada de cotação encerrada sem follow-up registado. Risco de o lead esfriar.",
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }

    // 7. Lead quente sem fecho
    // Boa chamada, cliente quente, baixo risco — mas sem follow-up agendado
    const arco = typeof a.arcoConversa === "string" ? a.arcoConversa : "";
    const arcoQuente = /quente/i.test(arco);
    if (
      a.riscoPerdaLead === "baixo" &&
      qualidade !== null && qualidade >= 4 &&
      arcoQuente &&
      !followUpNecessario
    ) {
      items.push({
        id: `${conversationId}-lead_quente`,
        tipo: "lead_quente_sem_fecho",
        prioridade: "media",
        titulo: "Lead quente — fecho não aproveitado",
        descricao:
          typeof a.narrativaConversa === "string" && a.narrativaConversa.trim()
            ? firstSentence(a.narrativaConversa)
            : `Arco: ${arco}. Chamada de alta qualidade com cliente receptivo, sem próximo passo definido.`,
        conversationId,
        agentName,
        customerPhone,
        runDate,
      });
    }
  }

  // Sort: priority first, then agent name
  items.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.prioridade] - PRIORITY_ORDER[b.prioridade];
    if (pd !== 0) return pd;
    return (a.agentName ?? "").localeCompare(b.agentName ?? "", "pt");
  });

  res.json(items);
});

export default router;
