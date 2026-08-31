/**
 * Create the equipa-360 rows in `colaboradores`, joining the two authoritative
 * sources that already exist in the environment:
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
 * Idempotent: upserts on `ringover_user_id`. Deliberately conservative — an
 * email that matches no Desk agent still gets a colaborador (so the panel can
 * at least show calls and follow-ups), but with `zid` null, and it is logged.
 * An email matching more than one Desk agent is logged and skipped entirely
 * rather than guessed: a wrong `zid` hands one agent another agent's tickets.
 */
import { db, pool, colaboradoresTable } from "@workspace/db";
import { ZohoAuth, ZohoDeskClient } from "@workspace/zoho-desk";
import { VIDA_AGENT_IDS } from "@workspace/ringover";
import { sql } from "drizzle-orm";

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
  ringoverUserId: string;
  email: string;
  nome: string;
  zid: string | null;
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

  const vidaExtra = new Set<number>(VIDA_AGENT_IDS);
  for (const p of (process.env.VIDA_AGENT_IDS ?? "").split(",")) {
    const n = parseInt(p.trim(), 10);
    if (!isNaN(n)) vidaExtra.add(n);
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
  console.log(apply ? "Modo: APLICAR\n" : "Modo: simulação (usa --apply para escrever)\n");

  const propostas: Proposta[] = [];
  let ignorados = 0;

  for (const [ringoverId, emailRaw] of Object.entries(mapa)) {
    const num = parseInt(ringoverId, 10);
    if (isNaN(num)) {
      console.warn(`IGNORADO   chave "${ringoverId}" não é um user_id numérico`);
      ignorados++;
      continue;
    }
    if (vidaExtra.has(num)) {
      console.log(`VIDA       ${ringoverId} <${emailRaw}> — fora do âmbito da 360`);
      ignorados++;
      continue;
    }
    const email = norm(emailRaw);
    if (!email) {
      console.warn(`IGNORADO   ${ringoverId} não tem email`);
      ignorados++;
      continue;
    }

    const matches = deskPorEmail.get(email) ?? [];
    if (matches.length > 1) {
      console.warn(
        `AMBÍGUO    ${ringoverId} <${email}> — ${matches.length} agentes no Desk (${matches
          .map((m) => m.id)
          .join(", ")}). Não criado.`,
      );
      ignorados++;
      continue;
    }

    const desk = matches[0];
    const nome = desk?.nome || nomeDoEmail(email);
    if (!desk) {
      console.warn(
        `SEM DESK   ${ringoverId} <${email}> — nenhum agente no Desk com este email. ` +
          `Criado na mesma, sem zid: vê chamadas e follow-ups, não vê tickets.`,
      );
    }
    console.log(
      `CRIAR      ${nome.padEnd(24)} ${ringoverId.padEnd(10)} <${email}> zid=${desk?.id ?? "—"}`,
    );
    propostas.push({ ringoverUserId: ringoverId, email, nome, zid: desk?.id ?? null });
  }

  if (apply && propostas.length > 0) {
    await db
      .insert(colaboradoresTable)
      .values(
        propostas.map((p) => ({
          nome: p.nome,
          ringoverUserId: p.ringoverUserId,
          zid: p.zid,
          email: p.email,
          equipa: "360" as const,
          papel: "agente" as const,
          ativo: true,
        })),
      )
      .onConflictDoUpdate({
        target: colaboradoresTable.ringoverUserId,
        // `papel` is deliberately NOT overwritten: promoting someone to
        // supervisor is a human decision, and re-running this must not undo it.
        set: {
          nome: sql`excluded.nome`,
          zid: sql`excluded.zid`,
          email: sql`excluded.email`,
          equipa: sql`excluded.equipa`,
          ativo: sql`excluded.ativo`,
        },
      });
  }

  const comZid = propostas.filter((p) => p.zid).length;
  console.log(
    `\nResumo: ${propostas.length} ${apply ? "criados/atualizados" : "a criar"}, ` +
      `${comZid} com zid do Desk, ${propostas.length - comZid} sem zid, ` +
      `${ignorados} ignorados.`,
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
