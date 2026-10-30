import app from "./app.js";
import { logger } from "./lib/logger.js";
import { seedAdminUser } from "./lib/seed.js";
import { setupSessionStore } from "./lib/setup-session-store.js";
import { setupPainelAcessos } from "./lib/setup-painel-acessos.js";
import { setupChamadasRingover } from "./lib/setup-chamadas-ringover.js";
import { sincronizarHistoricoEmFalta } from "./jobs/sync-chamadas-ringover.js";
import { setupChamadasSftp } from "./lib/setup-chamadas-sftp.js";
import { iniciarAgendadorChamadasSftp } from "./jobs/chamadas-sftp.js";
import { importarDoPortalSftp } from "./jobs/importar-portal-sftp.js";

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
    // Análise de Chamadas: tabelas e, em fundo, os últimos dias que faltarem.
    // Não espera pela sincronização — pode levar alguns minutos na 1.ª vez.
    .then(() => setupChamadasRingover())
    .then((pronto) => {
      if (pronto) {
        void sincronizarHistoricoEmFalta().catch((err) =>
          logger.warn({ err }, "análise de chamadas: histórico em falta não sincronizado"),
        );
      }
    })
    // Campanha Vida (gravações SolidNetworks no SFTP): tabelas, migração das
    // análises do portal SFTP (só se configurada) e o agendador de hora a hora
    // (só se SFTP_ANALISE_AUTOMATICA=1).
    .then(() => setupChamadasSftp())
    .then(() => {
      void importarDoPortalSftp().catch((err) =>
        logger.warn({ err }, "chamadas-sftp: importação do portal falhou"),
      );
      iniciarAgendadorChamadasSftp();
    })
    .catch((err) => logger.error({ err }, "Startup DB setup failed"));
});
