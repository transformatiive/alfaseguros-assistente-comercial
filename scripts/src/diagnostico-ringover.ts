/**
 * Is the Ringover link actually working, and where do missed calls go?
 *
 * Asked because "nobody has missed calls" is either a broken integration or an
 * empty table, and those look identical from the panel. This answers which, by
 * going to Ringover directly for the last N days and, for each day, comparing
 * what Ringover reports against what the `devolucoes` table holds.
 *
 * A day with missed calls at Ringover and zero rows in the table is a refresh
 * that never ran. A day with none at Ringover is a quiet day. They are very
 * different problems and the panel cannot tell them apart.
 *
 * Read-only on both sides.
 *
 *   DIAG_DIAS=10 pnpm --filter @workspace/scripts run diag:ringover
 */
import { RingoverClient } from "@workspace/ringover";
import { db, devolucoesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

function diasAtras(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Lisbon day bounds, as the refresh job computes them. */
function limites(data: string): [string, string] {
  return [`${data}T00:00:00.000Z`, `${data}T23:59:59.999Z`];
}

async function main(): Promise<void> {
  const chave = process.env.RINGOVER_API_KEY;
  if (!chave) {
    console.error("Falta RINGOVER_API_KEY — a ligação nem sequer pode ser testada.");
    process.exit(1);
  }
  const dias = Number(process.env.DIAG_DIAS ?? "10");
  const ringover = new RingoverClient({ apiKey: chave });

  // What the database holds, per day, in one query.
  const guardadas = await db
    .select({
      data: devolucoesTable.data,
      n: sql<number>`count(*)::int`,
      pendentes: sql<number>`count(*) filter (where ${devolucoesTable.estado} = 'pendente')::int`,
    })
    .from(devolucoesTable)
    .groupBy(devolucoesTable.data);
  const porData = new Map(guardadas.map((g) => [g.data, g]));

  console.log(`\n=== Ringover vs. base de dados, últimos ${dias} dias ===\n`);
  console.log("data         dia   chamadas  perdidas  na BD  pendentes   veredicto");

  for (let i = 1; i <= dias; i++) {
    const data = diasAtras(i);
    const [de, ate] = limites(data);

    let chamadas: Awaited<ReturnType<typeof ringover.listCallsBetween>>;
    try {
      chamadas = await ringover.listCallsBetween(de, ate);
    } catch (e) {
      console.log(`${data}   ERRO ao contactar o Ringover: ${(e as Error).message.slice(0, 80)}`);
      continue;
    }

    // The same rule `computeDevolucoes` applies: inbound, and not answered.
    const perdidas = chamadas.filter(
      (c) => c.direction === "in" && c.is_answered !== true,
    ).length;

    const g = porData.get(data);
    const naBD = g?.n ?? 0;
    const pend = g?.pendentes ?? 0;
    const nomeDia = new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-PT", {
      weekday: "short",
      timeZone: "UTC",
    });

    let veredicto: string;
    if (chamadas.length === 0) veredicto = "sem chamadas nenhumas (fim de semana / feriado?)";
    else if (perdidas === 0) veredicto = "dia sem perdidas — atenderam tudo";
    else if (naBD === 0) veredicto = "PERDIDAS NO RINGOVER E ZERO NA BD — o refresh nunca correu";
    else veredicto = "ok";

    console.log(
      [
        data.padEnd(12),
        nomeDia.padEnd(5),
        String(chamadas.length).padStart(8),
        String(perdidas).padStart(10),
        String(naBD).padStart(7),
        String(pend).padStart(10),
        "   " + veredicto,
      ].join(""),
    );
  }
  console.log();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
