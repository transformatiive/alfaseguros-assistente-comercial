/**
 * Did the daily analysis actually run?
 *
 * The `runs` table is the only durable record: the app redeploys on every merge
 * and its logs go with it, so "check the logs" answers nothing about last week.
 *
 * Read-only.
 *
 *   pnpm --filter @workspace/scripts run diag:runs
 */
import { db, runsTable, conversationsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";

async function main(): Promise<void> {
  const limite = Number(process.env.DIAG_LIMITE ?? "20");

  // The model is set as a Railway variable, and the Railway API returns
  // variable *names* to a connected app, never values — so the only honest way
  // to answer "which model is analysing" is to print it from inside.
  console.log(`\nModelo em uso: ${process.env.OPENROUTER_MODEL ?? "(não definido — usa o default do código)"}`);

  const runs = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.date))
    .limit(limite);

  if (runs.length === 0) {
    console.log("\nA tabela `runs` está vazia. A análise diária nunca correu.\n");
    return;
  }

  console.log(`\n=== últimas ${runs.length} corridas ===\n`);
  console.log("data         estado      conversas  analisadas  custo USD   registada em");
  for (const r of runs) {
    console.log(
      [
        r.date.padEnd(12),
        (r.status ?? "").padEnd(11),
        String(r.totalConversations ?? "-").padStart(9),
        String(r.analyzedConversations ?? "-").padStart(12),
        String(r.totalCostUsd ?? "-").padStart(11),
        "  " + r.createdAt.toISOString().slice(0, 16).replace("T", " "),
        r.errorMessage ? `\n             erro: ${r.errorMessage.slice(0, 160)}` : "",
      ].join(""),
    );
  }

  // The gap that matters: how long since the last one, and is the calendar
  // missing working days in between. A run that "exists" but is three weeks old
  // is the same problem as no run at all, and the table alone does not say so.
  const maisRecente = runs[0].date;
  const hoje = new Date().toISOString().slice(0, 10);
  const dias = Math.round(
    (Date.parse(hoje) - Date.parse(maisRecente)) / 86_400_000,
  );
  console.log(`\nMais recente: ${maisRecente} — há ${dias} dia(s).`);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(conversationsTable);
  console.log(`Conversas na base de dados: ${total}\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
