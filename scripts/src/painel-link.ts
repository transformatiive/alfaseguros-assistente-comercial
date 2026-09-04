/**
 * Mint a one-off link to the agent panel, for looking at it before the Zoho
 * extension exists.
 *
 * Runs from *inside* the platform because that is the only place the secret
 * lives: the Railway API returns variable names to a connected app, never
 * values. So `PAINEL_WIDGET_TOKEN` never has to travel through a person, a chat
 * window, or a paste buffer.
 *
 *   PAINEL_LINK_EMAIL=joao.catalao@alfaseguros.pt,tiago.paiva@alfaseguros.pt \
 *     pnpm --filter @workspace/scripts run painel:link
 *
 * Accepts several emails because one link is rarely enough to judge a layout:
 * the supervisor's own agent panel is nearly empty, so validating the *agent*
 * view needs somebody who actually has work. Minting them in one run also means
 * they share a validity window instead of expiring one at a time.
 *
 * Optional `PAINEL_LINK_DATA=YYYY-MM-DD` points the panel at a specific day.
 *
 * The link carries a real 15-minute token. That is short on purpose and is not
 * worth widening for convenience: re-run this when it expires.
 */

function exigir(nome: string): string {
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
  const widgetToken = exigir("PAINEL_WIDGET_TOKEN");
  const emails = exigir("PAINEL_LINK_EMAIL")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const data = process.env.PAINEL_LINK_DATA?.trim();
  const query = data ? `?data=${encodeURIComponent(data)}` : "";

  if (data) console.log(`\nDia: ${data}`);

  for (const email of emails) {
    const res = await fetch(`${base}/api/agente/sessao`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Painel-Widget-Token": widgetToken,
      },
      // `source: "desk"` so the request looks exactly like the widget's, and so
      // a preview link exercises the same code path production will use.
      body: JSON.stringify({ email, source: "desk" }),
    });

    if (!res.ok) {
      // One unknown email must not cost the whole run: the others are still
      // useful, and the failure names itself.
      console.log(`\n${email} — o servidor respondeu ${res.status}: ${await res.text()}`);
      continue;
    }

    const sessao = (await res.json()) as {
      token: string;
      expiraEm: string;
      colaborador: { nome: string; papel: string };
    };

    console.log("");
    console.log(`--- ${sessao.colaborador.nome} (${sessao.colaborador.papel}) — válido até ${sessao.expiraEm}`);
    console.log(`${base}/agente${query}#token=${encodeURIComponent(sessao.token)}`);
    if (sessao.colaborador.papel === "supervisor") {
      console.log(
        `${base}/agente/equipa${query}#token=${encodeURIComponent(sessao.token)}`,
      );
    }
  }
  console.log("");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
