/**
 * Create the equipa-360 rows in `colaboradores`.
 *
 * Membership comes from the committed roster in `equipa-360.ts` — NOT from
 * whoever happens to appear in an API listing. The roster is then enriched
 * from two sources:
 *
 *   AGENT_EMAIL_MAP  — Ringover numeric user_id → email (load-bearing for
 *                      /api/followups/pending, so it is already correct)
 *   Zoho Desk agents — zid, name, email
 *
 * Why this exists: starting the Railway database from zero left `colaboradores`
 * with only the Vida seed. The 360 agents lived solely in the abandoned Neon
 * database. The analysis flow never noticed, because it identifies agents from
 * `AGENT_EMAIL_MAP` alone — but the agent panel resolves a *colaborador*, so
 * with no rows there is nobody to show a panel to.
 *
 *   pnpm --filter @workspace/scripts run db:seed:360           # dry run
 *   pnpm --filter @workspace/scripts run db:seed:360 -- --apply
 *
 * Idempotent. Deliberately conservative — a roster member who matches no Desk
 * agent is still created, with `zid` null, and it is logged: the panel then
 * shows their calls and follow-ups and explains the missing tickets block. A
 * member matching MORE than one Desk agent is skipped entirely rather than
 * guessed, because a wrong `zid` hands one agent another agent's tickets.
 */
import { db, pool, colaboradoresTable } from "@workspace/db";
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { eq, sql } from "drizzle-orm";
import { EQUIPA_360 } from "./equipa-360.js";

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

/** "ana.silva@alfaseguros.pt" → "Ana Silva". Only a fallback. */
function nomeDoEmail(email: string): string {
  return (email.split("@")[0] ?? email)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface Proposta {
  ringoverUserId: string | null;
  email: string;
  nome: string;
  zid: string | null;
  papel: "agente" | "supervisor";
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");

  const raw = requireEnv("AGENT_EMAIL_MAP");
  let mapa: Record<string, string>;
  try {
    mapa = JSON.parse(raw) as Record<string, string>;
  } catch {
    console.error("AGENT_EMAIL_MAP não é JSON válido. Nada foi feito.");
    process.exit(1);
  }

  const auth = new ZohoAuth({
    clientId: requireEnv("ZOHO_DESK_CLIENT_ID"),
    clientSecret: requireEnv("ZOHO_DESK_CLIENT_SECRET"),
    refreshToken: requireEnv("ZOHO_DESK_REFRESH_TOKEN"),
  });
  const client = new ZohoDeskClient({ auth, orgId: requireEnv("ZOHO_DESK_ORG_ID") });
  const agentes = await client.listAgents();

  const deskPorEmail = new Map<string, { id: string; nome: string }[]>();
  for (const a of agentes) {
    const e = norm(a.emailId);
    if (!e) continue;
    const nome = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
    deskPorEmail.set(e, [...(deskPorEmail.get(e) ?? []), { id: a.id, nome }]);
  }

  console.log(`Agentes no Zoho Desk: ${agentes.length}`);
  console.log(`Entradas no AGENT_EMAIL_MAP: ${Object.keys(mapa).length}`);
  console.log(`Membros no roster da equipa 360: ${EQUIPA_360.length}`);
  console.log(apply ? "Modo: APLICAR\n" : "Modo: simulação (usa --apply para escrever)\n");

  const propostas: Proposta[] = [];
  let ignorados = 0;

  // AGENT_EMAIL_MAP is email → ringover id for lookup by roster email.
  const ringoverPorEmail = new Map<string, string>();
  for (const [ringoverId, emailRaw] of Object.entries(mapa)) {
    const e = norm(emailRaw);
    if (e && !isNaN(parseInt(ringoverId, 10))) ringoverPorEmail.set(e, ringoverId);
  }

  for (const membro of EQUIPA_360) {
    const email = norm(membro.email);
    if (!email) {
      console.warn(`IGNORADO   entrada do roster sem email`);
      ignorados++;
      continue;
    }

    const matches = deskPorEmail.get(email) ?? [];
    if (matches.length > 1) {
      console.warn(
        `AMBÍGUO    <${email}> — ${matches.length} agentes no Desk (${matches
          .map((m) => m.id)
          .join(", ")}). Não criado.`,
      );
      ignorados++;
      continue;
    }

    // AGENT_EMAIL_MAP wins when both exist: it is the same value that
    // /api/followups/pending already runs on, so agreeing with it keeps the
    // panel and the n8n payload attributing calls to the same person.
    const ringoverUserId = ringoverPorEmail.get(email) ?? membro.ringoverUserId ?? null;
    const desk = matches[0];
    const nome = desk?.nome || nomeDoEmail(email);

    if (!desk) {
      console.warn(
        `SEM DESK   ${nome} <${email}> — nenhum agente no Desk. Criado sem zid: ` +
          `vê chamadas e follow-ups, não vê tickets.`,
      );
    }
    if (!ringoverUserId) {
      console.warn(
        `SEM RINGOVER ${nome} <${email}> — sem user_id. Criado: vê tickets, ` +
          `não vê chamadas nem follow-ups.`,
      );
    }

    const origem = ringoverPorEmail.has(email) ? "env" : membro.ringoverUserId ? "roster" : "—";
    console.log(
      `CRIAR      ${nome.padEnd(22)} ${membro.papel.padEnd(10)} ` +
        `rid=${(ringoverUserId ?? "—").padEnd(10)}(${origem.padEnd(6)}) ` +
        `zid=${desk?.id ?? "—"}  <${email}>`,
    );
    propostas.push({ ringoverUserId, email, nome, zid: desk?.id ?? null, papel: membro.papel });
  }

  if (apply) {
    // Done row by row rather than with ON CONFLICT. `email` has no unique
    // constraint in the schema, and `ringover_user_id` is unique but nullable
    // — and in Postgres several NULLs do not conflict, so an ON CONFLICT on it
    // would insert a duplicate row on every run for anyone lacking an id.
    // Matching on email in code is unambiguous and needs no schema change.
    for (const p of propostas) {
      const [existente] = await db
        .select({ id: colaboradoresTable.id })
        .from(colaboradoresTable)
        .where(sql`lower(${colaboradoresTable.email}) = ${p.email}`)
        .limit(1);

      const valores = {
        nome: p.nome,
        ringoverUserId: p.ringoverUserId,
        zid: p.zid,
        email: p.email,
        equipa: "360" as const,
        papel: p.papel,
        ativo: true,
      };

      if (existente) {
        await db
          .update(colaboradoresTable)
          .set(valores)
          .where(eq(colaboradoresTable.id, existente.id));
      } else {
        await db.insert(colaboradoresTable).values(valores);
      }
    }
  }

  const comZid = propostas.filter((p) => p.zid).length;
  const comRid = propostas.filter((p) => p.ringoverUserId).length;
  const supervisores = propostas.filter((p) => p.papel === "supervisor").length;
  console.log(
    `\nResumo: ${propostas.length} ${apply ? "criados/atualizados" : "a criar"} ` +
      `(${supervisores} supervisor), ${comZid} com zid do Desk, ` +
      `${comRid} com user_id do Ringover, ${ignorados} ignorados.`,
  );
  if (!apply) console.log("Nada foi escrito. Corre com --apply para aplicar.");

  await pool.end();
}

void main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("seed-360 falhou:", err);
    process.exit(1);
  });

export {};
