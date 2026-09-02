/**
 * Diagnostic, read-only. Answers one question about the missed-call data:
 *
 *   When the same customer appears several times in a short window, is that a
 *   customer redialling, or ONE call ringing several agents in sequence?
 *
 * It matters because Ringover fires one `missed` webhook per agent rung, each
 * with a different `call_id` — so the n8n "Chamadas Perdidas" workflow can
 * create several tickets for one call, and `computeDevolucoes`, which keys on
 * `cdr_id`, can create several devoluções for it too.
 *
 * The distinguishing evidence is whether the rows share a `call_id` (one call,
 * several legs) or carry different ones (separate attempts).
 *
 *   pnpm --filter @workspace/scripts run diag:perdidas
 *   DIAG_DATE=2026-08-28 pnpm --filter @workspace/scripts run diag:perdidas
 *
 * Writes nothing. Prints only.
 */
import { RingoverClient, pickCustomerNumber, type RingoverCall } from "@workspace/ringover";
import { phoneFingerprint } from "@workspace/phone";

const LISBON_TZ = "Europe/Lisbon";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta a variável de ambiente ${name}`);
    process.exit(1);
  }
  return v;
}

/** Lisbon day bounds, duplicated here so the script stays free of api-server. */
function lisbonDayBounds(yyyymmdd: string): [string, string] {
  const probe = new Date(`${yyyymmdd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LISBON_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const nome = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  const off = m ? `${m[1]}${m[2]}:${m[3]}` : "+00:00";
  return [`${yyyymmdd}T00:00:00${off}`, `${yyyymmdd}T23:59:59${off}`];
}

function hora(iso: string | null | undefined): string {
  if (!iso) return "??:??:??";
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: LISBON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

const isInbound = (c: RingoverCall): boolean => c.direction === "in" || c.direction === "inbound";

async function main(): Promise<void> {
  const data = process.env.DIAG_DATE?.trim() || "2026-08-28";
  const ringover = new RingoverClient({ apiKey: requireEnv("RINGOVER_API_KEY") });

  const [inicio, fim] = lisbonDayBounds(data);
  const todas = await ringover.listCallsBetween(inicio, fim);
  const perdidas = todas.filter((c) => isInbound(c) && c.is_answered !== true);

  console.log(`\n=== ${data} ===`);
  console.log(`Chamadas no total:              ${todas.length}`);
  console.log(`De entrada, não atendidas:      ${perdidas.length}`);

  // How many distinct call_id values hide behind those cdr_id rows?
  const porCallId = new Map<string, RingoverCall[]>();
  let semCallId = 0;
  for (const c of perdidas) {
    const cid = c.call_id !== undefined && c.call_id !== null ? String(c.call_id) : null;
    if (!cid) {
      semCallId++;
      continue;
    }
    porCallId.set(cid, [...(porCallId.get(cid) ?? []), c]);
  }

  console.log(`cdr_id distintos:               ${new Set(perdidas.map((c) => String(c.cdr_id))).size}`);
  console.log(`call_id distintos:              ${porCallId.size}`);
  console.log(`sem call_id:                    ${semCallId}`);

  const multiPerna = [...porCallId.entries()].filter(([, cs]) => cs.length > 1);
  console.log(`\ncall_id com MAIS DE UMA perna:  ${multiPerna.length}`);
  if (multiPerna.length > 0) {
    console.log("(uma chamada a tocar em vários agentes — cada perna gera um webhook)\n");
    for (const [cid, cs] of multiPerna.slice(0, 5)) {
      const num = pickCustomerNumber(cs[0]) ?? "?";
      console.log(`  call_id=${cid}  cliente=${num}  pernas=${cs.length}`);
      for (const c of cs) {
        const uid = c.user?.user_id ?? c.user_id ?? "—";
        console.log(`     cdr=${String(c.cdr_id).padEnd(12)} ${hora(c.start_time)}  agente=${uid}`);
      }
    }
  }

  // Same customer, several distinct call_id values close together: genuine
  // redials, or separate attempts the team never answered.
  console.log("\n=== mesmo cliente, chamadas distintas ===");
  const porCliente = new Map<string, RingoverCall[]>();
  for (const c of perdidas) {
    const fp = phoneFingerprint(pickCustomerNumber(c));
    if (!fp) continue;
    porCliente.set(fp, [...(porCliente.get(fp) ?? []), c]);
  }
  const repetentes = [...porCliente.entries()]
    .filter(([, cs]) => cs.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`Clientes com mais de uma chamada perdida: ${repetentes.length}`);
  for (const [fp, cs] of repetentes.slice(0, 6)) {
    const ids = new Set(cs.map((c) => String(c.call_id ?? "?")));
    console.log(`\n  ...${fp}  ${cs.length} chamadas, ${ids.size} call_id distintos`);
    for (const c of cs.sort(
      (a, b) => new Date(a.start_time ?? 0).getTime() - new Date(b.start_time ?? 0).getTime(),
    )) {
      console.log(`     ${hora(c.start_time)}  call_id=${String(c.call_id ?? "—").padEnd(12)} cdr=${c.cdr_id}`);
    }
  }

  // Attribution: how many missed calls carry an agent at all?
  const comAgente = perdidas.filter(
    (c) => typeof (c.user?.user_id ?? c.user_id) === "number",
  ).length;
  console.log(`\n=== atribuição ===`);
  console.log(`Perdidas COM user_id:           ${comAgente}`);
  console.log(`Perdidas SEM user_id:           ${perdidas.length - comAgente}`);
}

void main().catch((err: unknown) => {
  console.error("diagnóstico falhou:", err);
  process.exit(1);
});

export {};
