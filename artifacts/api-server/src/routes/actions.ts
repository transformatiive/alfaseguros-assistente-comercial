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
  | "oportunidade_cross_sell";

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

    // 1. Follow-up pendente
    if (a.followUpNecessario === true) {
      const descricao =
        typeof a.followUpDescricao === "string" && a.followUpDescricao.trim()
          ? a.followUpDescricao
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

    // 2. Risco de perda de lead
    const risco = a.riscoPerdaLead as string | undefined;
    if (risco === "alto" || risco === "medio") {
      items.push({
        id: `${conversationId}-risco`,
        tipo: "risco_perda_lead",
        prioridade: risco === "alto" ? "alta" : "media",
        titulo: risco === "alto" ? "Risco alto de perda de lead" : "Risco médio de perda de lead",
        descricao:
          typeof a.narrativaConversa === "string" && a.narrativaConversa.trim()
            ? a.narrativaConversa.slice(0, 220)
            : "Potencial perda de lead identificada pela análise.",
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
        descricao: typeof d.detalhe === "string" ? d.detalhe : "",
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
            ? a.feedbackSupervisor.slice(0, 220)
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
        descricao: sugestao.slice(0, 220),
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
