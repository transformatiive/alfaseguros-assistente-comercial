/**
 * What the attribution actually produced, for one day.
 *
 * Deliberately separate from the panel: the panel shows one agent their own
 * work, and answering "did the new layers help" needs the whole day at once,
 * broken down by which layer decided. Read-only.
 *
 *   DIAG_DATE=2026-08-28 pnpm --filter @workspace/scripts run diag:devolucoes
 */
import { db, devolucoesTable, colaboradoresTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main(): Promise<void> {
  const data = process.env.DIAG_DATE?.trim() || new Date().toISOString().slice(0, 10);

  const linhas = await db
    .select({
      numero: devolucoesTable.numeroNormalizado,
      estado: devolucoesTable.estado,
      origem: devolucoesTable.atribuicaoOrigem,
      ticketId: devolucoesTable.ticketId,
      colaboradorId: devolucoesTable.colaboradorId,
      nome: colaboradoresTable.nome,
    })
    .from(devolucoesTable)
    .leftJoin(colaboradoresTable, eq(devolucoesTable.colaboradorId, colaboradoresTable.id))
    .where(eq(devolucoesTable.data, data));

  console.log(`\n=== ${data} — ${linhas.length} chamadas perdidas ===\n`);

  const porOrigem = new Map<string, number>();
  for (const l of linhas) {
    const k = l.origem ?? "(sem dono)";
    porOrigem.set(k, (porOrigem.get(k) ?? 0) + 1);
  }
  console.log("Por camada de atribuição:");
  for (const [k, n] of [...porOrigem.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(n).padStart(3)}`);
  }

  // Grouped the way the panel draws it: one line per number.
  const grupos = new Map<string, { nome: string | null; pendente: boolean }>();
  for (const l of linhas) {
    const g = grupos.get(l.numero);
    grupos.set(l.numero, {
      nome: l.nome ?? g?.nome ?? null,
      pendente: (g?.pendente ?? false) || l.estado === "pendente",
    });
  }
  const pendentes = [...grupos.values()].filter((g) => g.pendente);

  console.log(`\nLinhas no painel (agrupadas por número): ${grupos.size}`);
  console.log(`  ainda pendentes:  ${pendentes.length}`);

  const porAgente = new Map<string, number>();
  for (const g of pendentes) {
    const k = g.nome ?? "— balde partilhado —";
    porAgente.set(k, (porAgente.get(k) ?? 0) + 1);
  }
  console.log("\nLinhas pendentes por agente:");
  for (const [k, n] of [...porAgente.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${String(n).padStart(3)}`);
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
