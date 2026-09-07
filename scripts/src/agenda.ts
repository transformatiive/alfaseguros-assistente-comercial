/**
 * One scheduler tick: works out what is due and fires it.
 *
 * The *rule* — which jobs are due at a given Lisbon moment — lives next door in
 * `agenda-plano.ts`, with no network and no clock of its own, so it can be
 * pinned by a test. That split is not tidiness: this rule decides whether the
 * analysis runs at all, and a daylight-saving bug in it is a morning where the
 * team arrives to yesterday's panel and nothing says why.
 *
 * See `agenda-plano.ts` for why the timezone decision is in code rather than
 * in the cron expression.
 */

import { planear } from "./agenda-plano.js";

/* ── Execução ───────────────────────────────────────────────────────────── */

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST with a retry on 5xx and on a network error, never on a 4xx.
 *
 * The failure this exists for: a merge redeploys the app and starts this
 * service at the same moment, and the first request lands on a container that
 * is still coming up. A wrong secret, on the other hand, will not improve by
 * being asked twice.
 */
async function pedir(
  url: string,
  corpo: unknown,
  segredo: string,
  tentativas = 3,
): Promise<{ ok: boolean; estado: number; texto: string }> {
  let ultimoErro: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cron-Secret": segredo },
        body: JSON.stringify(corpo),
      });
      const texto = await res.text();
      if (res.status < 500 || i === tentativas) {
        return { ok: res.ok, estado: res.status, texto };
      }
      console.log(`HTTP ${res.status} — tentativa ${i} de ${tentativas}, a repetir`);
    } catch (err) {
      ultimoErro = err;
      if (i === tentativas) throw err;
      console.log(`Erro de rede na tentativa ${i} de ${tentativas}, a repetir`);
    }
    await esperar(i * 5000 + 5000);
  }
  throw ultimoErro ?? new Error("inalcançável");
}

function precisa(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta a variável de ambiente ${nome}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const base = (process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    console.error("Falta PUBLIC_APP_URL — não sei a que instância me dirigir.");
    process.exit(1);
  }
  const segredo = precisa("CRON_WEBHOOK_SECRET");
  const intervalo = Number(process.env.AGENDA_INTERVALO_MIN ?? 15);

  const plano = planear(new Date(), Number.isFinite(intervalo) ? intervalo : 15);
  const queDia =
    plano.analise === null ? "não" : plano.analise === 0 ? "hoje" : `há ${-plano.analise} dia(s)`;
  console.log(`Tick: ${plano.porque} → refresh=${plano.refresh} análise=${queDia}`);

  if (!plano.refresh && plano.analise === null) {
    console.log("Nada a fazer neste tick.");
    return;
  }

  let falhou = false;

  if (plano.refresh) {
    // Two hours of Desk history: enough to cover a missed tick, cheap enough
    // to run four times an hour without eating the org's API quota.
    const r = await pedir(`${base}/api/painel/refresh`, { janelaHoras: 2 }, segredo);
    console.log(`refresh → HTTP ${r.estado} ${r.texto.slice(0, 400)}`);
    if (!r.ok) falhou = true;
  }

  if (plano.analise !== null) {
    // The offset comes from the slot, not from a constant: the morning run
    // reads yesterday (the day whose calls are complete) and the afternoon one
    // reads today (which is what makes it worth paying for). The endpoint
    // resolves the offset in Lisbon time.
    const r = await pedir(
      `${base}/api/run`,
      { date_offset: plano.analise, source: "cron" },
      segredo,
    );
    console.log(`análise → HTTP ${r.estado} ${r.texto.slice(0, 400)}`);
    if (!r.ok) falhou = true;
  }

  if (falhou) process.exit(1);
}

void main().catch((err: unknown) => {
  console.error("agenda falhou:", err);
  process.exit(1);
});
