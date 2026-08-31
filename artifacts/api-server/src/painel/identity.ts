import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, colaboradoresTable, type Colaborador } from "@workspace/db";

/**
 * Resolve the Zoho-side identity of whoever opened the panel to a colaborador.
 *
 * Order matters: `zid` (Desk) and `crmUserId` (CRM) are stable ids issued by
 * Zoho, email is a fallback because an agent's email can be changed or reused.
 * Only an `ativo` colaborador resolves — someone who left the company must not
 * get a panel just because their Desk account still exists.
 */
export async function resolveColaborador(params: {
  deskUserId?: string | null;
  crmUserId?: string | null;
  email?: string | null;
}): Promise<Colaborador | null> {
  const byId = async (
    column: AnyPgColumn,
    value: string | null | undefined,
  ): Promise<Colaborador | null> => {
    const v = value?.trim();
    if (!v) return null;
    const [row] = await db
      .select()
      .from(colaboradoresTable)
      .where(and(eq(column, v), eq(colaboradoresTable.ativo, true)))
      .limit(1);
    return row ?? null;
  };

  const byZid = await byId(colaboradoresTable.zid, params.deskUserId);
  if (byZid) return byZid;

  const byCrm = await byId(colaboradoresTable.crmUserId, params.crmUserId);
  if (byCrm) return byCrm;

  const email = params.email?.trim().toLowerCase();
  if (!email) return null;
  const [row] = await db
    .select()
    .from(colaboradoresTable)
    .where(
      and(sql`lower(${colaboradoresTable.email}) = ${email}`, eq(colaboradoresTable.ativo, true)),
    )
    .limit(1);
  return row ?? null;
}
