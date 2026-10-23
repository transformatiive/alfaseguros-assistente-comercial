import app from "./app.js";
import { logger } from "./lib/logger.js";
import { seedAdminUser } from "./lib/seed.js";
import { setupSessionStore } from "./lib/setup-session-store.js";
import { setupPainelAcessos } from "./lib/setup-painel-acessos.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to the port immediately so deployment health checks pass,
// then run DB setup tasks in the background.
app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");

  setupSessionStore()
    .then(() => seedAdminUser())
    // Depois do seed e não em paralelo: a tabela dos acessos tem uma chave
    // estrangeira para `colaboradores`, e arrancar as duas coisas ao mesmo
    // tempo numa base vazia é uma corrida que não precisa de existir.
    .then(() => setupPainelAcessos())
    .catch((err) => logger.error({ err }, "Startup DB setup failed"));
});
