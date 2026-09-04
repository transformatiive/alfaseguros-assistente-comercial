import { inArray } from "drizzle-orm";
import { db, ticketsTable } from "@workspace/db";
import { emailDoTicket } from "./tickets-risco.js";

/**
 * Who a phone number belongs to, according to Desk.
 *
 * A call and a promise arrive from Ringover carrying a number and nothing
 * else. Desk is the only place a name or an address exists, so this joins the
 * two on the last nine digits — the only format both systems agree on.
 *
 * **Why it is not enough to reuse the tickets the panel already loaded.** Those
 * are this agent's *open tickets older than 24 hours*; a customer whose ticket
 * was opened this morning, or closed last week, or belongs to a colleague, is
 * not in that list. On a real day that left six of the panel's rows showing a
 * bare number for a customer Desk knows perfectly well by name.
 *
 * One query, whatever the number of fingerprints, and skipped entirely when
 * there are none.
 */
export interface ContactosPorFingerprint {
  nomes: Map<string, string>;
  emails: Map<string, string>;
}

export async function carregarContactos(
  fingerprints: readonly string[],
): Promise<ContactosPorFingerprint> {
  const nomes = new Map<string, string>();
  const emails = new Map<string, string>();
  if (fingerprints.length === 0) return { nomes, emails };

  const rows = await db
    .select({
      fp: ticketsTable.phoneFingerprint,
      nome: ticketsTable.contactName,
      raw: ticketsTable.rawJson,
      criado: ticketsTable.createdTime,
    })
    .from(ticketsTable)
    .where(inArray(ticketsTable.phoneFingerprint, [...new Set(fingerprints)]))
    // Oldest first, so the last write wins and each number ends up with the
    // name from the most recent ticket — the one most likely to be current.
    .orderBy(ticketsTable.createdTime);

  for (const r of rows) {
    if (!r.fp) continue;
    if (r.nome) nomes.set(r.fp, r.nome);
    const email = emailDoTicket(r.raw);
    if (email) emails.set(r.fp, email);
  }

  return { nomes, emails };
}
