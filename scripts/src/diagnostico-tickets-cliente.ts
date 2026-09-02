/**
 * Diagnostic, read-only. For every devolução left without a ticket, asks:
 *
 *   1. does ANY ticket exist for that phone, at any date?
 *   2. if so, who owns the most recent one?
 *
 * Two questions in one, on purpose. (1) tells us whether the first attribution
 * tier — the ticket created moments after the call — is broken or simply had
 * nothing to match. (2) measures how far a "owner of the customer's last
 * ticket" fallback would actually get us, before it is worth writing.
 *
 *   DIAG_DATE=2026-08-28 pnpm --filter @workspace/scripts run diag:tickets
 *
 * Writes nothing.
 */
import { db, pool, devolucoesTable, ticketsTable, colaboradoresTable } from "@workspace/db";
import { and, eq, isNull, desc } from "drizzle-orm";

async function main(): Promise<void> {
  const data = process.env.DIAG_DATE?.trim() || "2026-08-28";

  const semTicket = await db
    .select()
    .from(devolucoesTable)
    .where(and(eq(devolucoesTable.data, data), isNull(devolucoesTable.ticketId)));

  const comTicket = await db
    .select({ id: devolucoesTable.id })
    .from(devolucoesTable)
    .where(eq(devolucoesTable.data, data));

  console.log(`\n=== ${data} ===`);
  console.log(`Devoluções no total:        ${comTicket.length}`);
  console.log(`Sem ticket emparelhado:     ${semTicket.length}`);

  // How many tickets do we hold at all, and how many carry a fingerprint?
  const [{ total } = { total: 0 }] = await db
    .select({ total: ticketsTable.id })
    .from(ticketsTable)
    .limit(1)
    .then((r) => r.map(() => ({ total: 1 })));
  const todosTickets = await db
    .select({ id: ticketsTable.id, fp: ticketsTable.phoneFingerprint })
    .from(ticketsTable);
  const comFingerprint = todosTickets.filter((t) => t.fp).length;
  console.log(`\nTickets na base de dados:   ${todosTickets.length}`);
  console.log(`  com phone_fingerprint:    ${comFingerprint}`);
  console.log(`  SEM phone_fingerprint:    ${todosTickets.length - comFingerprint}`);
  void total;

  const zids = new Map<string, string>();
  for (const c of await db
    .select({ zid: colaboradoresTable.zid, nome: colaboradoresTable.nome })
    .from(colaboradoresTable)) {
    if (c.zid) zids.set(c.zid, c.nome);
  }

  let comHistorico = 0;
  let semHistorico = 0;

  console.log(`\n=== por devolução sem ticket ===`);
  for (const d of semTicket) {
    const anteriores = await db
      .select({
        id: ticketsTable.id,
        numero: ticketsTable.ticketNumber,
        assunto: ticketsTable.subject,
        assigneeId: ticketsTable.assigneeId,
        createdTime: ticketsTable.createdTime,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.phoneFingerprint, d.numeroNormalizado))
      .orderBy(desc(ticketsTable.createdTime))
      .limit(3);

    if (anteriores.length === 0) {
      semHistorico++;
      console.log(`  ${d.numeroCliente.padEnd(14)} SEM TICKETS — cliente novo`);
      continue;
    }
    comHistorico++;
    const ult = anteriores[0];
    const dono = ult.assigneeId ? (zids.get(ult.assigneeId) ?? `zid ${ult.assigneeId}`) : "sem dono";
    console.log(
      `  ${d.numeroCliente.padEnd(14)} ${anteriores.length} ticket(s), último #${ult.numero ?? "?"} ` +
        `de ${ult.createdTime?.toISOString().slice(0, 10) ?? "?"} → ${dono}`,
    );
  }

  console.log(`\n=== resumo ===`);
  console.log(`Sem ticket, MAS com histórico:  ${comHistorico}  ← a 2ª camada resolveria estes`);
  console.log(`Sem ticket e sem histórico:     ${semHistorico}  ← clientes novos, balde partilhado`);

  await pool.end();
}

void main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("diagnóstico falhou:", err);
    process.exit(1);
  });

export {};
