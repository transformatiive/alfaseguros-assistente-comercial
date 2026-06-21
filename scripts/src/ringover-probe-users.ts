/**
 * Probe the Ringover account for its full user (agent) roster, so we can seed
 * the Vida operator list for the Supervisor Virtual V2 (TRNSF-1178).
 *
 *   pnpm --filter @workspace/scripts run ringover:probe-users
 *
 * Reads-only. Does NOT write to Postgres. Prints to stdout.
 *
 * For each agent it prints: user_id · nome · email · team_id · equipa inferida.
 * The team inference mirrors the existing logic:
 *   - 360  → name is in the hard-coded "Não Vida / 360" allowlist
 *            (artifacts/api-server/src/lib/teams.ts)
 *   - vida → everyone else (and anyone in VIDA_AGENT_IDS)
 * Use the output to confirm the real Vida roster before seeding `colaborador`.
 */
import { RingoverClient, VIDA_AGENT_IDS, type RingoverUser } from "@workspace/ringover";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}`);
    process.exit(1);
  }
  return v;
}

/**
 * The 8 names currently classified as "360 (Não Vida)" — kept in sync by hand
 * with artifacts/api-server/src/lib/teams.ts (TEAM_360_NORMALIZED). Anyone not
 * in this set is treated as Vida today.
 */
const TEAM_360_NORMALIZED = new Set([
  "andreia almeida",
  "andreia coelho",
  "vania rodrigues",
  "marina fernandes",
  "joao martins",
  "joao catalao",
  "tiago paiva",
  "ana inacio",
]);

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fullName(u: RingoverUser): string {
  return [u.firstname, u.lastname].filter(Boolean).join(" ").trim();
}

function inferTeam(u: RingoverUser): "360" | "vida" {
  if (VIDA_AGENT_IDS.has(u.user_id)) return "vida";
  return TEAM_360_NORMALIZED.has(normalizeName(fullName(u))) ? "360" : "vida";
}

async function main(): Promise<void> {
  const client = new RingoverClient({ apiKey: requireEnv("RINGOVER_API_KEY") });

  const users = await client.listUsers();
  console.log(`# Ringover users (agents): ${users.length}\n`);

  const rows = users
    .map((u) => ({
      user_id: u.user_id,
      name: fullName(u) || "(sem nome)",
      email: u.email ?? "(sem email)",
      team_id: u.team_id ?? "?",
      team: inferTeam(u),
      filtered: VIDA_AGENT_IDS.has(u.user_id),
    }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));

  console.log("## Todos os agentes (user_id · nome · email · team_id · equipa inferida)");
  for (const r of rows) {
    const flag = r.filtered ? "  ⛔ filtrado (VIDA_AGENT_IDS)" : "";
    console.log(
      `- [${r.team.toUpperCase().padEnd(4)}] ${String(r.user_id).padEnd(10)} ${r.name.padEnd(28)} ${r.email.padEnd(34)} team_id=${r.team_id}${flag}`,
    );
  }
  console.log("");

  const vida = rows.filter((r) => r.team === "vida");
  console.log(`## Candidatos a equipa VIDA (${vida.length})`);
  console.log("# Confirme estes nomes — é a base para semear `colaborador`.\n");
  for (const r of vida) {
    console.log(`- ${r.name} · user_id=${r.user_id} · ${r.email}`);
  }
}

void main().catch((err: unknown) => {
  console.error("ringover-probe-users failed:", err);
  process.exit(1);
});

export {};
