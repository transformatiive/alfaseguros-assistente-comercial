import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, conversationsTable, ticketsTable } from "@workspace/db";
import { ListConversationsParams } from "@workspace/api-zod";
import { phoneFingerprint } from "@workspace/phone";
import { derivarAcoes } from "../painel/acoes.js";

/**
 * "Ações do Dia" for the supervisor.
 *
 * The seven rules moved to `painel/acoes.ts` so the agent panel can apply the
 * same ones. This route keeps the loading, the contact-name lookup, and — most
 * importantly — the exact response shape it has always had: the supervisor
 * client reads these fields, and a shared module is not a licence to change
 * what an existing endpoint returns.
 */

const router: IRouter = Router();

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

  // Batch-fetch the most recent contact name per phone fingerprint (single
  // query, no N+1).
  const fingerprints = [
    ...new Set(
      conversations
        .map((c) => phoneFingerprint(c.customerPhone))
        .filter((fp): fp is string => !!fp),
    ),
  ];
  const contactNameByFp = new Map<string, string>();
  if (fingerprints.length > 0) {
    const rows = await db
      .select({ fp: ticketsTable.phoneFingerprint, name: ticketsTable.contactName })
      .from(ticketsTable)
      .where(inArray(ticketsTable.phoneFingerprint, fingerprints))
      .orderBy(ticketsTable.createdTime);
    // Later rows (more recent) overwrite earlier ones, giving the most recent name
    for (const row of rows) {
      if (row.fp && row.name) contactNameByFp.set(row.fp, row.name);
    }
  }

  const acoes = derivarAcoes(conversations, (telefone) => {
    const fp = phoneFingerprint(telefone);
    return (fp && contactNameByFp.get(fp)) || null;
  });

  // Mapped field by field rather than returned whole: `agentId` is new on the
  // shared type and must not appear here, because this response shape is a
  // contract the supervisor client already depends on.
  res.json(
    acoes.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      prioridade: a.prioridade,
      titulo: a.titulo,
      descricao: a.descricao,
      conversationId: a.conversationId,
      agentName: a.agentName,
      customerPhone: a.customerPhone,
      contactName: a.contactName,
      runDate: a.runDate,
    })),
  );
});

export default router;
