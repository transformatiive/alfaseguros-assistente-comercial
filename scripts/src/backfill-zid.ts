/**
 * Backfill `colaboradores.zid` (the Zoho Desk agent id) for the equipa 360 by
 * listing agents from the Desk API and matching on email, case-insensitively.
 *
 *   pnpm --filter @workspace/scripts run db:backfill:zid          # dry run
 *   pnpm --filter @workspace/scripts run db:backfill:zid -- --apply
 *
 * One-off, idempotent, and deliberately conservative: a colaborador whose
 * email does not match exactly one Desk agent is *logged and skipped*, never
 * guessed. Writing the wrong zid would hand one agent another agent's panel.
 *
 * Requires DATABASE_URL and the ZOHO_DESK_* credentials.
 */
import { db, pool, colaboradoresTable } from "@workspace/db";
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { and, eq } from "drizzle-orm";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta a variável de ambiente ${name}`);
    process.exit(1);
  }
  return v;
}

function norm(email: string | null | undefined): string | null {
  const t = email?.trim().toLowerCase();
  return t ? t : null;
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");

  const auth = new ZohoAuth({
    clientId: requireEnv("ZOHO_DESK_CLIENT_ID"),
    clientSecret: requireEnv("ZOHO_DESK_CLIENT_SECRET"),
    refreshToken: requireEnv("ZOHO_DESK_REFRESH_TOKEN"),
  });
  const client = new ZohoDeskClient({ auth, orgId: requireEnv("ZOHO_DESK_ORG_ID") });

  const agents = await client.listAgents();
  console.log(`Agentes no Zoho Desk: ${agents.length}`);

  // email → agent ids. A list, not a single id, so a duplicated email is
  // visible as ambiguous instead of silently resolving to whichever came last.
  const byEmail = new Map<string, string[]>();
  for (const a of agents) {
    const e = norm(a.emailId);
    if (!e) continue;
    byEmail.set(e, [...(byEmail.get(e) ?? []), a.id]);
  }

  const colaboradores = await db
    .select()
    .from(colaboradoresTable)
    .where(and(eq(colaboradoresTable.equipa, "360"), eq(colaboradoresTable.ativo, true)));

  console.log(`Colaboradores 360 ativos: ${colaboradores.length}`);
  console.log(apply ? "Modo: APLICAR\n" : "Modo: simulação (usa --apply para escrever)\n");

  let atualizados = 0;
  let jaTinham = 0;
  let semCorrespondencia = 0;

  for (const c of colaboradores) {
    const email = norm(c.email);
    if (!email) {
      console.warn(`SEM EMAIL   ${c.nome} (id ${c.id}) — não é possível fazer o match`);
      semCorrespondencia++;
      continue;
    }
    const matches = byEmail.get(email) ?? [];
    if (matches.length === 0) {
      console.warn(`SEM MATCH   ${c.nome} <${email}> — nenhum agente no Desk com este email`);
      semCorrespondencia++;
      continue;
    }
    if (matches.length > 1) {
      console.warn(`AMBÍGUO     ${c.nome} <${email}> — ${matches.length} agentes no Desk: ${matches.join(", ")}`);
      semCorrespondencia++;
      continue;
    }
    const zid = matches[0];
    if (c.zid === zid) {
      jaTinham++;
      continue;
    }
    if (c.zid && c.zid !== zid) {
      console.warn(`CONFLITO    ${c.nome} <${email}> — já tem zid ${c.zid}, o Desk diz ${zid}. Não alterado.`);
      semCorrespondencia++;
      continue;
    }
    console.log(`ATUALIZAR   ${c.nome} <${email}> → zid ${zid}`);
    if (apply) {
      await db.update(colaboradoresTable).set({ zid }).where(eq(colaboradoresTable.id, c.id));
    }
    atualizados++;
  }

  console.log(
    `\nResumo: ${atualizados} ${apply ? "atualizados" : "a atualizar"}, ` +
      `${jaTinham} já corretos, ${semCorrespondencia} por resolver à mão.`,
  );
  await pool.end();
}

void main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("backfill-zid falhou:", err);
    process.exit(1);
  });

export {};
