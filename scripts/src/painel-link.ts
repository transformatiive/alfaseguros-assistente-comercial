/**
 * Mint a one-off link to the agent panel, for looking at it before the Zoho
 * extension exists.
 *
 * Runs from *inside* the platform because that is the only place the secret
 * lives: the Railway API returns variable names to a connected app, never
 * values. So `PAINEL_WIDGET_TOKEN` never has to travel through a person, a chat
 * window, or a paste buffer.
 *
 *   PAINEL_LINK_EMAIL=joao.catalao@alfaseguros.pt \
 *     pnpm --filter @workspace/scripts run painel:link
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
  const email = exigir("PAINEL_LINK_EMAIL");
  const data = process.env.PAINEL_LINK_DATA?.trim();

  const res = await fetch(`${base}/api/agente/sessao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Painel-Widget-Token": widgetToken,
    },
    // `source: "desk"` so the request looks exactly like the widget's, and so a
    // preview link exercises the same code path it will use in production.
    body: JSON.stringify({ email, source: "desk" }),
  });

  if (!res.ok) {
    console.error(`O servidor respondeu ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const sessao = (await res.json()) as {
    token: string;
    expiraEm: string;
    colaborador: { nome: string; papel: string };
  };

  const query = data ? `?data=${encodeURIComponent(data)}` : "";
  const url = `${base}/agente${query}#token=${encodeURIComponent(sessao.token)}`;

  console.log("");
  console.log(`Colaborador: ${sessao.colaborador.nome} (${sessao.colaborador.papel})`);
  console.log(`Válido até:  ${sessao.expiraEm}`);
  if (data) console.log(`Dia:         ${data}`);
  console.log("");
  console.log(url);
  console.log("");
  if (sessao.colaborador.papel === "supervisor") {
    console.log(`Vista da equipa: ${base}/agente/equipa${query}#token=…  (mesma aba no ecrã)`);
    console.log("");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
