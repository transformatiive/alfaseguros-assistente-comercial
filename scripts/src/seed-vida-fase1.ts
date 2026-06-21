/**
 * Apply the Supervisor Virtual V2 seed for the Vida team, Fase 1:
 * the 11 operators + the checklist catalogue (5 categories / 17 points).
 *
 *   pnpm --filter @workspace/scripts run db:seed:vida
 *
 * Idempotent — safe to run repeatedly (operators upsert on ringover_user_id;
 * categories/items inserted only if absent). Requires DATABASE_URL and the
 * schema to be pushed first (`pnpm --filter @workspace/db run push`).
 */
import { db, pool } from "@workspace/db";
import { seedVidaFase1 } from "@workspace/db/seed";

async function main(): Promise<void> {
  const r = await seedVidaFase1(db);
  console.log(
    `Seed Vida Fase 1 aplicado: ${r.colaboradores} colaboradores, ` +
      `${r.categorias} categorias novas, ${r.itens} itens novos.`,
  );
  await pool.end();
}

void main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("seed-vida-fase1 failed:", err);
    process.exit(1);
  });

export {};
