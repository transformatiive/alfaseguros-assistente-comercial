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
  const data = process.env.PAINEL_REFRESH_DATE?.trim();

  const url = `${base}/api/painel/refresh`;
  console.log(`POST ${url}${data ? ` (data=${data})` : " (hoje)"}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cron-Secret": segredo },
    body: JSON.stringify(data ? { date: data } : {}),
  });

  const texto = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(texto), null, 2));
  } catch {
    console.log(texto);
  }

  // A non-2xx is a real failure of the trigger itself. A 200 whose body reports
  // a failed half is not — the endpoint returns 200 on purpose in that case,
  // and the body already says which half, so exit 0 and let the log speak.
  if (!res.ok) process.exit(1);
}

void main().catch((err: unknown) => {
  console.error("painel-refresh falhou:", err);
  process.exit(1);
});

export {};
