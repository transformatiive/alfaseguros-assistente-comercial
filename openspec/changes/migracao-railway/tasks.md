# Tasks: Migração Replit → Railway

> Ordered. Nothing here changes application behaviour. If a task requires a behaviour change, stop and raise it.

## 1. Make the build platform-neutral

- [x] 1.1 In `artifacts/supervisor/vite.config.ts`, move `runtimeErrorOverlay()` inside the existing `REPL_ID`-guarded block
- [x] 1.2 Confirm `pnpm run build` succeeds with `REPL_ID` unset and `BASE_PATH=/`
- [x] 1.3 Add `BASE_PATH` to `.env.example` with a comment

## 2. Serve the SPA from Express

- [x] 2.1 In `artifacts/api-server/src/app.ts`, after `app.use("/api", router)`, mount `express.static` on the supervisor build output
- [x] 2.2 Add an SPA fallback that excludes `/api/` and `/leads`
- [x] 2.3 Resolve the client directory from the **built** file location — verify it works from `dist/index.mjs`, not only from `src/`
- [x] 2.4 (não foi preciso — o caminho resolve) If the path does not resolve after bundling, copy `artifacts/supervisor/dist/public` into `artifacts/api-server/dist/public` as a build step and serve from there
- [x] 2.5 Verify locally: `pnpm run build && PORT=3000 node artifacts/api-server/dist/index.mjs` serves the UI at `/` and the API at `/api/health`
- [x] 2.6 Verify `/leads` still returns the server-rendered HTML and is not swallowed by the fallback

## 3. Provision Railway

- [x] 3.1 Create Railway project `alfaseguros-supervisor` in the `transformatiive's Projects` workspace
- [x] 3.2 Add a Postgres service; note the reference variable `${{Postgres.DATABASE_URL}}`
- [x] 3.3 Create the app service from the GitHub repo `transformatiive/alfaseguros-assistente-comercial`, branch `main`
- [x] 3.4 Add `railway.json` with build command `pnpm install --frozen-lockfile && pnpm run build`, start command `node artifacts/api-server/dist/index.mjs`, healthcheck path `/api/health`
- [x] 3.5 Pin Node 24 and pnpm (Nixpacks config or Dockerfile)
- [x] 3.6 Generate a Railway domain

## 4. Move configuration

- [ ] 4.1 Copy every variable listed in `design.md` → "Environment variables to move" into Railway
- [x] 4.2 Set `DATABASE_URL` as a reference to the Railway Postgres service
- [x] 4.3 Set `NODE_ENV=production`, `BASE_PATH=/`
- [x] 4.4 Set `PUBLIC_APP_URL` to the new Railway domain (do not copy the Replit value)
- [ ] 4.5 Copy `AGENT_EMAIL_MAP` from `.replit` `[userenv.shared]` — it is not in Replit Secrets
- [x] 4.6 Confirm `SESSION_SECRET` is a real secret, not the `change-me-in-production` default

## 5. Move the data

- [ ] 5.1 `pg_dump` the Replit database to a local file during a quiet window (evening or weekend)
- [ ] 5.2 Restore into Railway Postgres
- [ ] 5.3 Run `pnpm --filter @workspace/db run push` against Railway to confirm the schema matches with no pending drift
- [ ] 5.4 Spot-check row counts: `conversations`, `tickets`, `cases`, `daily_summaries`, `colaboradores`, `users`
- [ ] 5.5 Confirm the `user_sessions` table exists (created by `setupSessionStore()` on boot)

## 6. Verify on Railway before cutover

- [ ] 6.1 Log in with an existing user; confirm the session cookie survives a page reload
- [ ] 6.2 Confirm 2FA login works end to end
- [ ] 6.3 Open a past day and confirm cached analyses render with zero cost
- [ ] 6.4 Trigger `POST /api/run` manually with the cron secret for a past date and confirm a cache hit
- [ ] 6.5 Call `GET /api/followups/pending` with the Bearer token and diff the response against Replit's
- [ ] 6.6 Call `GET /api/alertas-dia` and diff against Replit's
- [ ] 6.7 Confirm `/leads` renders

## 7. Cut over

- [ ] 7.1 Grep the n8n instance for the Replit hostname; list every node that matches
- [ ] 7.2 Repoint each one to the Railway domain
- [ ] 7.3 Disable the Replit cron trigger (do not delete the Replit deployment)
- [ ] 7.4 Run one full real analysis on Railway and compare its output to the previous day's Replit output for shape and cost
- [ ] 7.5 Watch for one working week

## QA — independent validation

> This change is implemented under `.claude/skills/implementation-qa-handoff/SKILL.md`.
> Claude Code is the builder. It does not approve its own work.

- [ ] Q.1 After **each** numbered section above, produce a QA handoff in the format the skill prescribes and write it to `qa-handoff/<section>.md`
- [ ] Q.2 Use the `#### Scenario:` blocks in `specs/supervisor/spec.md` verbatim as the acceptance criteria — do not paraphrase them and do not add your own
- [ ] Q.3 State plainly, per scenario, whether it was actually exercised or only implemented. "Not verified" is an acceptable answer; a false "done" is not
- [ ] Q.4 Hand off to the independent QA agent. Final status is **READY FOR INDEPENDENT QA**, never approved or done
- [ ] Q.5 Defects come back as a new section of tasks, fixed at root cause with a regression test that would have failed before the fix, then returned for retest
- [ ] Q.6 Archive this change folder only after independent QA returns PASS

## 8. Close out

- [ ] 8.1 Update `README.md`, `CLAUDE.md` and `replit.md` to say Railway
- [ ] 8.2 Record the Railway project id, service id and domain in the credential vault under the Alfaseguros entry
- [ ] 8.3 After one clean week, delete the Replit deployment
- [ ] 8.4 Merge this change's delta into `openspec/specs/supervisor/spec.md` and move this folder to `changes/archive/`
