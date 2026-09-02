import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes/index.js";
import leadsRouter from "./routes/leads.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";

const PgSession = connectPgSimple(session);
const cfg = env();

const isProd = process.env["NODE_ENV"] === "production";

const app: Express = express();

// Trust Replit's reverse proxy so req.secure and cookies work correctly
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      // Do NOT use createTableIfMissing — the table.sql file is not bundled.
      // Table is created explicitly in setupSessionStore() at startup.
    }),
    secret: cfg.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public, server-rendered HTML dashboard (no auth, not under /api).
app.use(leadsRouter);

app.use("/api", router);

// --- Static SPA hosting -----------------------------------------------------
//
// On Replit the API and the browser client ran as two artifacts on two ports,
// stitched into one origin by Replit's application router. Railway routes by
// domain, not by path, so the Express process serves the client itself. This is
// mounted AFTER the /leads router and AFTER /api, so no existing path changes
// meaning.

/**
 * Locate the built supervisor client. Checked in order:
 *  1. `<dist>/public` — present when the build copies the client into the API
 *     bundle directory (a self-contained image).
 *  2. `<dist>/../../supervisor/dist/public` — the pnpm workspace layout, where
 *     `artifacts/supervisor` sits next to `artifacts/api-server`.
 *
 * Resolved from `import.meta.url` rather than the source tree, because esbuild
 * bundles this module into `dist/index.mjs` and the path must be correct there.
 */
/**
 * Static-asset paths, for the agent panel's SPA fallback. Same intent as
 * `ASSET_EXTENSIONS` further down: a request for a missing asset must 404 as an
 * asset, because HTML served with a 200 in its place fails as
 * "Unexpected token '<'", which is a confusing way to learn a build is broken.
 */
const AGENTE_ASSET_RE =
  /\.(css|js|mjs|map|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

function resolveClientDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "public"),
    path.resolve(here, "../../supervisor/dist/public"),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "index.html"))) ?? null;
}

/**
 * Locate the built agent panel, the same two-candidate way as the supervisor
 * client. It is a separate Vite build with its own base path (`/agente/`), so
 * it is a separate directory and a separate mount.
 */
function resolveAgenteDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "agente"),
    path.resolve(here, "../../agente/dist/public"),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "index.html"))) ?? null;
}

const clientDir = resolveClientDir();
const agenteDir = resolveAgenteDir();

// --- Agent panel, mounted at /agente ----------------------------------------
//
// Mounted BEFORE the supervisor client so its SPA fallback wins for /agente/*;
// the supervisor fallback is a catch-all and would otherwise answer with the
// wrong index.html. Nothing else changes meaning: /api, /leads and every
// existing supervisor route are untouched.
if (agenteDir === null) {
  logger.warn("Painel do agente não encontrado; a API continua a servir /api normalmente.");
} else {
  logger.info({ agenteDir }, "A servir o painel do agente em /agente");

  app.use("/agente", express.static(agenteDir, { index: false, maxAge: "1h" }));

  const agenteIndex = path.join(agenteDir, "index.html");
  app.use("/agente", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // A missing asset must 404 as an asset, not as HTML — same reasoning as the
    // supervisor fallback below.
    if (AGENTE_ASSET_RE.test(req.path)) return next();
    if (!req.accepts("html")) return next();
    res.sendFile(agenteIndex);
  });
}

if (clientDir === null) {
  // The API is still fully functional without the client — /api and /leads are
  // unaffected. Warn rather than crash so a misbuilt image is diagnosable.
  logger.warn(
    "Built supervisor client not found; serving API only. Run `pnpm run build`.",
  );
} else {
  logger.info({ clientDir }, "Serving supervisor client");

  app.use(express.static(clientDir, { index: false, maxAge: "1h" }));

  // File extensions that mean "this is a static asset request". A request for a
  // missing asset must 404 as an asset — if it fell through to index.html the
  // browser would receive HTML with a 200 and fail with "Unexpected token '<'",
  // which is a genuinely confusing way to discover a broken build.
  //
  // Matching a known list rather than "has any extension" keeps SPA routes safe:
  // a path like /conversas/some.id is still routed to the client.
  const ASSET_EXTENSIONS = new Set([
    ".css",
    ".js",
    ".mjs",
    ".map",
    ".json",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".mp4",
    ".webm",
    ".txt",
    ".xml",
    ".webmanifest",
  ]);

  // SPA fallback. Deliberately narrow:
  //  - only GET/HEAD, so a stray POST does not receive HTML
  //  - never /api/*, so unmatched API routes keep returning their own response
  //  - never /leads, which is server-rendered HTML by leadsRouter above
  //  - never a static asset path, per ASSET_EXTENSIONS above
  //  - only when the client will accept HTML
  const indexHtml = path.join(clientDir, "index.html");

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    if (req.path === "/leads" || req.path.startsWith("/leads/")) return next();
    if (ASSET_EXTENSIONS.has(path.extname(req.path).toLowerCase())) {
      return next();
    }
    if (!req.accepts("html")) return next();
    res.sendFile(indexHtml);
  });
}

export default app;
