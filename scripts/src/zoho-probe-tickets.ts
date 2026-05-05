/**
 * Probe Zoho Desk to surface the standard fields and `cf_*` custom fields
 * Alfaseguros has on real tickets. Used to wire the outcome classifier
 * (HANDOVER §5).
 *
 *   pnpm --filter @workspace/scripts run zoho:probe-tickets -- --days=14 --limit=30
 *
 * Reads-only. Does NOT write to Postgres. Prints to stdout.
 */
import { ZohoAuth, ZohoDeskClient, type ZohoTicket } from "@workspace/zoho-desk";

interface CliArgs {
  days: number;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { days: 14, limit: 30 };
  for (const a of argv) {
    const m = /^--(days|limit)=(\d+)$/.exec(a);
    if (!m) continue;
    if (m[1] === "days") out.days = Number(m[2]);
    if (m[1] === "limit") out.limit = Number(m[2]);
  }
  return out;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const auth = new ZohoAuth({
    clientId: requireEnv("ZOHO_DESK_CLIENT_ID"),
    clientSecret: requireEnv("ZOHO_DESK_CLIENT_SECRET"),
    refreshToken: requireEnv("ZOHO_DESK_REFRESH_TOKEN"),
  });
  const client = new ZohoDeskClient({ auth, orgId: requireEnv("ZOHO_DESK_ORG_ID") });

  const to = new Date();
  const from = new Date(to.getTime() - args.days * 86_400_000);

  console.log(`# Probing Zoho Desk tickets created ${from.toISOString()} → ${to.toISOString()}`);
  console.log(`# Limit on detail printout: ${args.limit}\n`);

  const tickets = await client.listTicketsCreatedBetween({
    createdTimeFrom: from.toISOString(),
    createdTimeTo: to.toISOString(),
  });
  console.log(`Total tickets returned: ${tickets.length}\n`);

  // Standard-field overview (first 5 tickets)
  console.log("## Standard fields (first 5 tickets)");
  for (const t of tickets.slice(0, 5)) {
    console.log(
      [
        `- ${t.id} #${t.ticketNumber} "${t.subject ?? ""}"`,
        `  status=${t.status} statusType=${t.statusType} channel=${t.channel}`,
        `  category=${t.category} productName=${t.productName} resolution=${t.resolution ?? "(none)"}`,
        `  closedTime=${t.closedTime ?? "(open)"}`,
      ].join("\n"),
    );
  }
  console.log("");

  // cf_* survey across the batch
  const cfFields = new Map<string, Set<string>>();
  for (const t of tickets.slice(0, args.limit)) {
    const cf = (t.cf ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(cf)) {
      const set = cfFields.get(k) ?? new Set<string>();
      set.add(typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
      cfFields.set(k, set);
    }
  }
  console.log("## Custom fields (cf_*)");
  if (cfFields.size === 0) {
    console.log("(none observed in sample)");
  } else {
    for (const [k, vs] of [...cfFields.entries()].sort()) {
      const sample = [...vs].slice(0, 5).map((v) => (v.length > 60 ? v.slice(0, 60) + "…" : v));
      console.log(`- ${k} (${vs.size} distinct value${vs.size === 1 ? "" : "s"}): ${sample.join(" | ")}`);
    }
  }
  console.log("");

  // Status breakdown
  const statusCounts = new Map<string, number>();
  for (const t of tickets) {
    const key = `${t.status ?? "?"} (${t.statusType ?? "?"})`;
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  console.log("## Status breakdown");
  for (const [k, n] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${k}: ${n}`);
  }
}

void main().catch((err: unknown) => {
  console.error("zoho-probe-tickets failed:", err);
  process.exit(1);
});

// Keep TS happy when no value is referenced from this module externally.
export {};
export type _ProbeTicket = ZohoTicket;
