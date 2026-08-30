# Design: Migração Replit → Railway

## Architecture overview

**Today (Replit)**

```
Replit application router
  ├── port 8080  → artifacts/supervisor  (vite preview, serves the SPA)
  └── port 3000  → artifacts/api-server  (Express, /api/*)
```

The router is what makes `/` and `/api/*` look like one origin. Railway does not have this.

**Target (Railway)**

```
Railway service "supervisor"  (one process, one PORT, one domain)
  └── artifacts/api-server (Express 5)
        ├── /api/*      → existing router (unchanged)
        ├── /leads      → existing server-rendered HTML (unchanged)
        ├── /assets/*   → express.static(artifacts/supervisor/dist/public)
        └── /*          → SPA fallback → index.html

Railway service "Postgres"  → DATABASE_URL referenced by the app service
```

## Decisions

### Decision: One service, not two

Railway routes by domain, not by path. Splitting API and UI into two services would put them on two different origins, which breaks the `sid` session cookie and forces a CORS + credentials configuration that does not exist today.

One service keeps the same-origin assumption the code already makes, keeps the cookie working, and halves the running cost.

### Decision: Express serves the SPA

`artifacts/api-server/src/app.ts` gains static serving mounted **after** `/api` and after the `/leads` router, so no existing path changes meaning:

```ts
// after app.use("/api", router)
const clientDir = path.resolve(__dirname, "../../supervisor/dist/public");
app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
app.get(/^\/(?!api\/|leads).*/, (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});
```

The build must therefore produce the SPA bundle **into the image**, and the esbuild bundle for the API must not try to bundle those static files. `build.mjs` already emits to `artifacts/api-server/dist`, so the path above resolves at runtime from the built file's location — verify this explicitly during implementation, since esbuild rewrites `__dirname` semantics for ESM output.

### Decision: `BASE_PATH` stays an explicit env var

`artifacts/supervisor/vite.config.ts` throws if `BASE_PATH` is unset. Keep that guard — it is a good guard — and set `BASE_PATH=/` in the Railway build environment. The later agent app will set `BASE_PATH=/agente/`.

### Decision: Replit Vite plugins become conditional

`runtimeErrorOverlay()` is applied unconditionally in `vite.config.ts`. `cartographer` and `devBanner` are already guarded behind `process.env.REPL_ID !== undefined`. Extend the same guard to `runtimeErrorOverlay` so a Railway build never depends on a Replit-only plugin resolving.

Keep the packages in `devDependencies`. Removing them is a bigger diff for no benefit while Replit is still the rollback target.

### Decision: `trust proxy` and cookie flags stay as they are

`app.set("trust proxy", 1)` is correct behind Railway's proxy too. `sameSite: "none"` + `secure: true` in production stays — it is required anyway once the panel is embedded in a Zoho Desk iframe.

### Decision: Database moves by dump and restore, not by dual-write

The dataset is a few months of calls, conversations, tickets and analyses. A single `pg_dump` / `psql` restore during a quiet window is simpler and safer than any sync scheme. Re-running an already-analysed day is a cache hit and costs nothing, so a small amount of data loss during the window is recoverable by re-running the day.

### Decision: Keep Replit alive, cron off, for one week

Rollback = re-enable the Replit cron and repoint n8n. No redeploy needed. Delete the Replit deployment only after one clean week on Railway.

## Environment variables to move

From `artifacts/api-server/src/lib/env.ts`:

`DATABASE_URL` (Railway reference), `SESSION_SECRET`, `RINGOVER_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `CRON_WEBHOOK_SECRET`, `PUBLIC_APP_URL`, `ANALYSIS_CONCURRENCY`, `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ORG_ID`, `ZOHO_DESK_NAOVIDA_DEPARTMENT_ID`, `FOLLOWUP_API_TOKEN`, `AGENT_EMAIL_MAP`, `VIDA_AGENT_IDS`, `FOLLOWUP_EXCLUDE_PRODUCTS`.

Plus, Railway-specific: `NODE_ENV=production`, `BASE_PATH=/`.

Note: `AGENT_EMAIL_MAP` currently lives in `.replit` under `[userenv.shared]`, not in Replit Secrets. It is easy to miss. It maps Ringover numeric `user_id` to email and is load-bearing for `/api/followups/pending`.

`PUBLIC_APP_URL` must be updated to the Railway domain, not copied.

## n8n callers to repoint

Every n8n node pointing at the Replit URL:

- Supervisor Virtual daily cron `4rx93UXKxdDdmPpY` → `POST /api/run` with `X-Cron-Secret`
- Any workflow consuming `GET /api/followups/pending` (Bearer `FOLLOWUP_API_TOKEN`)
- Any workflow consuming `GET /api/alertas-dia`
- Any workflow consuming `GET /api/email/summary`

Grep the n8n instance for the Replit hostname before cutover rather than assuming this list is complete.

## Files to create or modify

| File | Change |
|---|---|
| `artifacts/api-server/src/app.ts` | add static serving + SPA fallback after the `/api` mount |
| `artifacts/api-server/package.json` | ensure `start` runs the built bundle; no `dev` build step in prod |
| `artifacts/supervisor/vite.config.ts` | make `runtimeErrorOverlay` conditional on `REPL_ID` |
| `railway.json` (new) | build + start commands, healthcheck on `/api/health` |
| `Dockerfile` or Nixpacks config (new, if needed) | pin Node 24 + pnpm, run `pnpm run build` |
| `.env.example` | add `BASE_PATH`, note `AGENT_EMAIL_MAP` |
| `README.md`, `CLAUDE.md`, `replit.md` | replace "runs on Replit" with Railway; keep Replit section as historical note |
