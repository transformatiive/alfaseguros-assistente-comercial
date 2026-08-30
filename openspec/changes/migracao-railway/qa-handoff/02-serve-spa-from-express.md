# QA HANDOFF — Section 2: Serve the SPA from Express

Change: `openspec/changes/migracao-railway`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Summary

The Express process now serves the built supervisor client as well as the API,
so the whole app is one origin on one port — the structural change the migration
needs, because Railway routes by domain and has no path-based router.

Static serving and the SPA fallback are mounted **after** `leadsRouter` and after
`app.use("/api", router)`, so no existing path changes meaning. No route, handler,
response shape, analysis logic or schema was touched.

## Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/app.ts` | `resolveClientDir()`, `express.static`, SPA fallback middleware |

## Requirement coverage

Acceptance criteria are the `#### Scenario:` blocks in
`openspec/changes/migracao-railway/specs/supervisor/spec.md`, verbatim.

| Requirement / AC | Implemented | Developer test | Local result |
|---|---|---|---|
| Scenario: API and UI on one origin | Yes | login + `/api/auth/me` against the built bundle, one process, one port, no CORS config | **exercised — pass** |
| Scenario: Existing server-rendered routes are unaffected | Yes | `GET /leads` byte-compared against `index.html` | **exercised — pass** |
| Scenario: Cron trigger after cutover | No — sections 3–7 | none | not exercised |
| Scenario: Health check | Partially — see "Health check path" below | `GET /api/healthz` before DB setup completes | **exercised — pass, but at a different path than the spec says** |
| Scenario: Same day analysed on both platforms | No — sections 5–7 | none | not exercised |

## Tests executed

A real Postgres 16 was started locally and the Drizzle schema pushed into it, so
these ran against the actual built bundle and a real database — not mocks.

```
pnpm --filter @workspace/db run push          # [✓] Changes applied
env -u REPL_ID BASE_PATH=/ PORT=8080 pnpm run build
DATABASE_URL=... PORT=3000 NODE_ENV=production node artifacts/api-server/dist/index.mjs
```

Boot log confirms task 2.3 — the client directory resolves from the **bundled**
`dist/index.mjs`, not from `src/`:

```
{"clientDir":"…/artifacts/supervisor/dist/public","msg":"Serving supervisor client"}
{"port":3000,"msg":"Server listening"}
```

| Request | Result |
|---|---|
| `GET /` | 200 `text/html` — `index.html` |
| `GET /conversas` | 200, byte-identical to `index.html` |
| `GET /conversas/abc.id` (dot in an SPA path) | 200, byte-identical to `index.html` |
| `GET /assets/index-<hash>.js` | 200 `text/javascript`, `cache-control: public, max-age=3600` |
| `GET /assets/nao-existe.js` | **404** |
| `GET /nao-existe.css` | **404** |
| `GET /api/healthz` | 200 `{"status":"ok"}` |
| `GET /leads` | 503, and the body is the **server-rendered** `<html lang="pt">` page, not the SPA (503 only because no Zoho Desk credentials exist here) |
| `GET /api/leads` | 503, same page |
| `GET /api/rota-inexistente` | 401 from `requireAuth` — unchanged, not swallowed |
| `POST /` | 404, not `index.html` |

Session flow, with `X-Forwarded-Proto: https` to simulate Railway's proxy
(the cookie is `secure`, so plain HTTP correctly refuses to set it):

| Step | Result |
|---|---|
| `POST /api/auth/login` | 200, `Set-Cookie: sid=…` |
| `GET /api/auth/me` with the cookie | 200 `{"id":1,"username":"admin","role":"admin"}` |
| Same request again (reload) | 200 — session survives |
| `GET /api/auth/me` without the cookie | 401 |
| `select count(*) from user_sessions` | 2 rows — persisted to Postgres |

## Defect found and fixed during development

The first implementation gated the fallback on `req.accepts("html")` alone. That
is wrong: browsers request assets with `Accept: */*`, which matches `html`, so
**`GET /assets/nao-existe.js` returned `index.html` with a 200**. A broken build
would have surfaced to users as `Unexpected token '<'` rather than a 404.

Fixed by matching a known list of static-file extensions and passing those
through to the 404. Matching a list rather than "has any extension" keeps SPA
routes with a dot in them working — verified above with `/conversas/abc.id`.

## Health check path — needs a decision

The delta spec's `#### Scenario: Health check` and task 3.4 both say
**`/api/health`**. The route in the code is **`/api/healthz`**
(`artifacts/api-server/src/routes/health.ts`). `/api/health` falls through to
`requireAuth` and returns **401**, which Railway would read as an unhealthy
service and the deployment would never go live.

Not fixed here. Adding a `/api/health` alias would be a behaviour change, which
this change forbids without asking. Two options:

- **Point Railway's healthcheck at `/api/healthz`** and correct the spec text.
  No code change. Recommended.
- Add `/api/health` as an alias — a new route, a behaviour change.

Task 3.4 must not be executed with `/api/health` until this is settled.

## Test data / preconditions

- Postgres 16 on `127.0.0.1:55432`, database `supervisor`, schema via
  `drizzle-kit push`
- The server seeds a default admin on first boot (`admin` / `admin123`) and logs
  a warning to change it. QA should verify this account does **not** exist with
  the default password on any deployed environment.
- `NODE_ENV=production` and a throwaway `SESSION_SECRET`. No real secret was used.

## User journeys QA must test

1. Log in through the browser at `/`, land on the dashboard, hard-reload — the
   session must survive and the SPA must re-render.
2. Navigate to `/conversas`, open a conversation, then **reload on that deep URL**
   — the fallback must serve the SPA and the client must route correctly.
3. Open `/leads` directly and confirm the server-rendered dashboard, not the SPA.
4. Open devtools → Network, hard-reload, and confirm **no request returns HTML
   where JS or CSS was expected** and there are no 404s on assets.
5. Log out and confirm protected `/api/*` calls return 401 again.

## Data that must be visually verified

Everything the SPA renders, because this is the first time it is served by
Express rather than by Vite preview: dashboard totals, the conversation list and
detail page, operators, checklist, pipeline. Confirm the data is present and
correct, not merely that the pages render.

## Permissions / roles to verify

`admin` vs `viewer` on `/admin/utilizadores`. The fallback serves `index.html`
for **any** non-API path including `/admin/utilizadores` — that is correct, since
authorisation is enforced by the API, not by who can fetch the HTML shell. QA
should confirm a `viewer` reaching that URL is refused by the API.

## Regression areas

- **`/leads`** — the highest-risk path, since it is server-rendered HTML at the
  root and sits next to the fallback. Verified not intercepted.
- **Unmatched `/api/*`** — still handled by the API stack, not the fallback.
- **CORS** — `cors({ origin: true, credentials: true })` was left exactly as it
  was. Same-origin now means it is not exercised, but it was not removed.
- **Cookie flags** — `sameSite: "none"`, `secure: true` in production, unchanged.
- Nothing under `artifacts/supervisor/**` was modified.

## Known risks

- `express.static` is mounted with `maxAge: "1h"` per `design.md`. `index.html`
  is served by `res.sendFile` without an explicit cache header, so a stale
  `index.html` could be cached by an intermediary and reference hashed assets
  that no longer exist. Not observed; worth a look under a CDN or custom domain.
- The default admin seed (`admin`/`admin123`) runs on every boot where the user
  table is empty. On a fresh Railway database with an empty `users` table this
  will create it. Pre-existing behaviour, but the migration makes it newly
  reachable on a new public domain — call it out before cutover.
- `resolveClientDir()` returns `null` and logs a warning rather than crashing if
  the client is missing. A misbuilt image therefore starts and passes a
  healthcheck while serving no UI. Deliberate — the API stays useful — but it
  means "the service is up" does not imply "the UI is there".

## Assumptions

- Serving `/leads` from `leadsRouter` at the root, ahead of the fallback, is the
  intended arrangement — unchanged from before.
- SPA routes never use a path segment ending in one of the listed asset
  extensions. Verified against the current `App.tsx` route table.
- `503` on `/leads` here is only the missing Zoho Desk credentials, not a
  regression. The body proves the correct handler ran.

## Not verified

- **Anything on Railway.** All of this ran locally.
- The SPA in a real browser — every check above was `curl`. No JavaScript was
  executed, so a client-side routing or asset-path problem would not have shown
  up. This is the single biggest gap and the reason journeys 1–4 above matter.
- `/leads` returning a **200** with real content — no Zoho Desk credentials here.
  Only that it is not intercepted by the fallback.
- 2FA login (`/api/auth/totp/*`).
- HTTPS behaviour. The proxy was simulated with a header, not with real TLS.
- Behaviour when `artifacts/supervisor/dist/public` is absent — the `null` branch
  was reasoned about but never executed.
- Node 24. This ran on Node 22.

## Suggested evidence for QA

- Boot log showing the `clientDir` line and the resolved path.
- Browser devtools Network tab on a hard reload of `/` and of a deep route: all
  assets 200, correct content types, no HTML where JS was expected.
- Screenshot of `/leads` rendering its own dashboard next to `/` rendering the SPA.
- `curl -i` of `/api/healthz` returning 200 during startup, before the
  `Session store ready` line appears.
- A DB check that `user_sessions` gains a row on login.

## Final status

**READY FOR INDEPENDENT QA**
