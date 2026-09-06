/**
 * Fire the panel refresh against a running instance.
 *
 * Exists because the cron secret is not readable from outside the platform:
 * the Railway API returns variable *names* to a connected app, not values. So
 * the request is made from inside, where `CRON_WEBHOOK_SECRET` is present in
 * the environment and never has to travel through a person or a chat window.
 *
 *   pnpm --filter @workspace/scripts run painel:refresh
 *   PAINEL_REFRESH_DATE=2026-09-01 pnpm --filter @workspace/scripts run painel:refresh
 *
 * Read-only towards the LLM: it calls an endpoint that, by construction and by
 * test, cannot reach OpenRouter.
 */

/** Sleep, for the backoff between attempts. */
function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST the refresh, retrying a transient failure.
 *
 * The one that actually happened: this script runs on a Railway service wired
 * to the same repo, so a merge starts it and the *app's* own redeploy at the
 * same moment. The first request landed while the app was restarting and got
 * `502 Application failed to respond` — nothing wrong with the refresh, the
 * server simply was not up yet. Every later date returned 200.
 *
 * So a 5xx or a network error is retried; a 4xx is not, because a wrong secret
 * or a malformed date will not get better by asking again.
 */
async function pedirComRetentativa(
  url: string,
  corpo: unknown,
  segredo: string,
  tentativas = 3,
): Promise<{ res: Response; texto: string }> {
  let ultimoErro: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cron-Secret": segredo },
        body: JSON.stringify(corpo),
      });
      const texto = await res.text();
      if (res.status < 500 || i === tentativas) return { res, texto };
      console.log(`HTTP ${res.status} — tentativa ${i} de ${tentativas}, a repetir`);
    } catch (err) {
      ultimoErro = err;
      if (i === tentativas) throw err;
      console.log(`Erro de rede na tentativa ${i} de ${tentativas}, a repetir`);
    }
    // 5s, 15s: long enough for a container to finish coming up, short enough
    // that a genuinely down instance still fails the run inside a minute.
    await esperar(i * 5000 + 5000);
  }
  throw ultimoErro ?? new Error("inalcançável");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta a variável de ambiente ${name}`);
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
  const segredo = requireEnv("CRON_WEBHOOK_SECRET");

  // Accepts a comma-separated list so a backfill is one run rather than one
  // deploy per day. Empty means today, which is what the schedule wants.
  const datas = (process.env.PAINEL_REFRESH_DATE ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const alvos: (string | null)[] = datas.length > 0 ? datas : [null];

  const url = `${base}/api/painel/refresh`;
  let falhou = false;

  for (const data of alvos) {
    console.log(`\nPOST ${url}${data ? ` (data=${data})` : " (hoje)"}`);

    const { res, texto } = await pedirComRetentativa(
      url,
      data ? { date: data } : {},
      segredo,
    );
    console.log(`HTTP ${res.status}`);
    try {
      console.log(JSON.stringify(JSON.parse(texto), null, 2));
    } catch {
      console.log(texto);
    }

    // One bad day must not abandon the rest: a backfill that stops at the first
    // failure leaves a hole nobody notices. The exit code still reports it.
    if (!res.ok) falhou = true;
  }

  // A non-2xx is a real failure of the trigger itself. A 200 whose body reports
  // a failed half is not — the endpoint returns 200 on purpose in that case,
  // and the body already says which half, so exit 0 and let the log speak.
  if (falhou) process.exit(1);
}

void main().catch((err: unknown) => {
  console.error("painel-refresh falhou:", err);
  process.exit(1);
});

export {};
