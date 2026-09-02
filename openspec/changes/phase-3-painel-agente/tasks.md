# Tasks: Phase 3 — Painel do agente embebido no Zoho Desk

> Ordered. Each task is small enough for one Claude Code session and testable on its own.
> **Prerequisite:** `migracao-railway` is shipped and the app is live on Railway.
> **Hard rule for every task:** do not modify `artifacts/supervisor/**`, `middleware/require-auth.ts`, `routes/auth.ts`, or `schema/users.ts`. Do not change any existing `/api` response shape.

## 0. Groundwork

- [x] 0.1 Add `papel` to `lib/db/src/schema/colaboradores.ts`: `text` with enum `agente | supervisor | nenhum`, notNull, default `agente`
- [x] 0.2 Create `lib/db/src/schema/devolucoes.ts`: `id`, `ringoverCallId` (unique), `data` (date), `colaboradorId`, `numeroCliente`, `numeroNormalizado`, `horaChamada`, `estado` (`pendente | devolvida | dispensada`), `resolvidaAt`, `resolvidaPor`, `origem` (`auto | manual`), `contexto` (text, nullable — what the voice agent captured), timestamps
- [x] 0.3 Export both from `lib/db/src/schema/index.ts`; run `pnpm --filter @workspace/db run push`
- [x] 0.4 Add `AGENT_TOKEN_SECRET`, `PAINEL_WIDGET_TOKEN`, `AGENTE_APP_URL` to `lib/env.ts` and `.env.example`
- [x] 0.5 ~~Confirm the equipa-360 agents have a CRM licence that permits Web Tabs~~ — **answered 2026-08-31: all 360 agents hold Zoho One with Zoho Desk access. Section 7B is cut regardless; see below.**
- [x] 0.6 ~~Add `crmUserId` to `colaboradores` for the CRM-side identity join~~ — **shipped, then orphaned by the 7B cut. The column and the `crmUserId` branch of `resolveColaborador` stay in place (harmless, and cheap insurance if a CRM surface is ever wanted), but nothing writes or reads them today.**
- [ ] 0.7 Backfill `colaboradores.zid` for the nine 360-team agents by listing agents from the Desk API and matching on email; write it as a one-off script under `scripts/`, log any agent that does not match instead of guessing

## 1. Identity and token

- [x] 1.1 `src/painel/token.ts` — `mintAgentToken(colaborador)` and `verifyAgentToken(raw)`; HS256, 15 min, claims `sub`, `zid`, `papel`, `equipa`
- [x] 1.2 `src/painel/identity.ts` — `resolveColaborador({ deskUserId, email })`: match on `zid`, fall back to case-insensitive email, require `ativo = true`
- [x] 1.3 `src/middleware/require-agent.ts` — export `requireAgent` and `requireSupervisor`; both read `Authorization: Bearer`, verify, attach `req.agente`; `requireSupervisor` additionally requires `papel = 'supervisor'`
- [x] 1.4 `src/routes/agente.ts` — `POST /api/agente/sessao`. Guard on `X-Painel-Widget-Token` matching `PAINEL_WIDGET_TOKEN`. Body `{ deskUserId, email, portalId, source }`. Reject if `portalId !== ZOHO_DESK_ORG_ID`. Rate limit to 30/min per IP. Log every mint with requested and resolved identity
- [x] 1.5 Unit tests: valid mint, unknown agent → 403, inactive agent → 403, wrong portal → 403, wrong widget token → 401, expired token rejected by `requireAgent`

## 2. Chamadas por devolver (the smallest viable version)

- [x] 2.1 `src/painel/devolucoes.ts` — `computeDevolucoes(date)`: fetch the day's calls from Ringover, keep inbound + unanswered, normalise the customer number with `@workspace/phone`
- [x] 2.2 Auto-resolve: if any outbound call to the same normalised number exists after the missed call on the same day, mark `devolvida` with `origem = 'auto'`
- [x] 2.3 Attribute each missed call to a colaborador using the same Ringover `user_id` → colaborador mapping the grouper already uses; unattributed calls go to a shared bucket visible to the supervisor
- [x] 2.4 Idempotent upsert keyed on `ringoverCallId` — running twice must not duplicate or resurrect a resolved row
- [x] 2.5 `GET /api/agente/devolucoes?data=` — this agent's pending list, ordered oldest first
- [x] 2.6 `POST /api/agente/devolucoes/:id/concluir` with `{ estado: "devolvida" | "dispensada" }` — must reject an id belonging to another colaborador
- [x] 2.7 Unit tests: auto-resolution window, idempotency, cross-agent access denied

## 3. The rest of the panel payload

- [x] 3.1 Extract the follow-up query from `routes/followups.ts` into `src/painel/followups-query.ts` with an optional `colaboradorId` filter. Re-point `routes/followups.ts` at it and assert its response is byte-identical for a fixed fixture — n8n depends on this
- [x] 3.2 `src/painel/agente.ts` — `buildAgentePainel(colaborador, date)` returning `{ devolucoes, ticketsEmRisco, followUps, agendamentos: null, atualizadoEm }`
- [x] 3.3 Tickets em risco: query `tickets` for open status, `createdAt < now - 24h`, assignee matching the agent's `zid`; include age in hours and the Desk deep link
- [x] 3.4 `GET /api/agente/painel?data=` behind `requireAgent`
- [x] 3.5 `agendamentos` returns `null` with a `motivo` string, never an empty array — the UI must be able to tell "none today" from "not available yet"

## 4. Supervisor view

- [x] 4.1 `src/painel/supervisor.ts` — `buildSupervisorPainel(date)`: per-agent counts for each block across `colaboradores` where `equipa = '360'` and `ativo = true`
- [x] 4.2 Redistribution suggestion: rule-based, not AI. Compute each agent's load as a weighted count, flag any agent above 1.5x the team median, and suggest moving their oldest pending items to the agent furthest below the median. Return the suggestion with its reasoning as plain text
- [x] 4.3 `GET /api/supervisor/painel?data=` behind `requireSupervisor`
- [x] 4.4 Unit tests for the redistribution rule, including the degenerate cases: one agent, all agents equal, everyone at zero

## 5. Scheduled refresh

- [ ] 5.1 `src/routes/painel-refresh.ts` — `POST /api/painel/refresh`, guarded by `X-Cron-Secret` exactly like `/api/run`
- [ ] 5.2 It runs `computeDevolucoes(today)` and `syncTickets(today - 2d, today)`. It MUST NOT call the LLM
- [ ] 5.3 Assert in a test that no OpenRouter call is issued during a refresh
- [ ] 5.4 Create two n8n schedules: 08:00 and 16:30 Lisbon, Monday to Friday, both hitting `/api/painel/refresh`
- [ ] 5.5 Leave the existing 06:00 cron and the daily email running untouched

## 6. Frontend

- [ ] 6.1 Scaffold `artifacts/agente` — Vite + React + Tailwind + TanStack Query + Wouter, `BASE_PATH=/agente/`, added to `pnpm-workspace.yaml`
- [ ] 6.2 Copy only the shadcn primitives actually used (card, badge, button, tabs, skeleton, separator, tooltip) from the supervisor artifact; do not import across artifacts and do not move the originals
- [ ] 6.3 Boot sequence: read `location.hash` for the token, store it in memory, clear the hash with `history.replaceState`, then fetch the panel
- [ ] 6.4 On 401, post a message to the parent frame so the widget re-mints and reloads the iframe
- [ ] 6.5 Agent panel page: the four blocks, dense, light background, mobile-narrow by default since the Desk left panel is narrow
- [ ] 6.6 Supervisor panel page at `/agente/equipa`, rendered only when the token carries `papel = supervisor`
- [ ] 6.7 Explicit empty states per block, and a visibly different placeholder for agendamentos
- [ ] 6.8 Serve the build from Express under `/agente` (extends the static serving added in `migracao-railway`)

## 7A. Zoho Desk launcher

> Desk cannot host a full-page dashboard. This is a launcher, not the panel. Do not try to render the dashboard inside a Desk panel.

- [ ] 7A.1 Scaffold with `zet init` for Zoho Desk; set `plugin-manifest.json` name, version, and the app domain in allowed domains
- [ ] 7A.2 Single widget at location `desk.topband`. Confirm the key against the current Sigma manifest schema — location keys change between versions, do not copy them from a blog post
- [ ] 7A.3 Widget: `ZOHODESK.extension.onload()`, then `ZOHODESK.get("user")` and `ZOHODESK.get("portal")`
- [ ] 7A.4 Render one button, "O meu painel", plus a live count of pending devoluções so the band is useful at a glance without opening anything
- [ ] 7A.5 On click: POST to `/api/agente/sessao`, then `window.open(AGENTE_APP_URL + "/agente#token=...", "_blank")`
- [ ] 7A.6 On 403, replace the button with a plain Portuguese message naming the agent's Desk email and asking them to contact Nuno — most 403s will be a missing `zid`
- [ ] 7A.7 `zet pack`, install privately in the Alfaseguros portal, test with one real agent account

## 7B. ~~Zoho CRM Web Tab~~ — CUT

> **Cut on 2026-08-31.** This section existed only to work around a premise that
> turned out to be false: that Zoho Desk could not host a full page. It can —
> `desk.topband` is documented as a **full-screen view** opened from the top
> navigation bar, which is exactly what was asked for ("um menu no topo do desk,
> e depois o dashboard em baixo, nada de barras laterais").
>
> With the Desk surface doing the whole job, a second surface in the CRM is a
> detour with no return: another SDK, another identity path, another embed to
> keep working, for a page the agent already reaches in one click from where
> they actually work.
>
> Licences were never the blocker — every 360 agent holds Zoho One. The reason
> for the cut is scope, not capability.
>
> **What this drops:** tasks 7B.1–7B.6, and the verification items 8.8 and 8.11
> that only made sense inside a CRM iframe.
>
> **What survives:** the `crmUserId` column and the CRM branch of
> `resolveColaborador`. Both are already written, both are inert, and neither
> costs anything to keep. Deleting them would be churn for its own sake.

## 7C. Seamless session

- [ ] 7C.1 When a token is redeemed from a **top-level** navigation (the Desk launcher path), set an `httpOnly; Secure; SameSite=Lax` cookie scoped to `/agente`, 8 hours, holding the same claims
- [ ] 7C.2 Never set or read that cookie when the app detects it is framed (`window.top !== window.self`)
- [ ] 7C.3 Cold open with neither token nor cookie: render a single "Entrar com o Zoho" button that starts Zoho OAuth. No password prompt, no agent picker
- [ ] 7C.4 Assert in a test that no code path ever renders a username/password form

## 8. Verification

- [ ] 8.1 Two agents logged into Desk at the same time see different lists
- [ ] 8.2 A colaborador with `ativo = false` is refused
- [ ] 8.3 An agent cannot resolve another agent's devolução
- [ ] 8.4 An agent without `papel = supervisor` gets 403 on `/api/supervisor/painel`
- [ ] 8.5 `GET /api/followups/pending` output is unchanged against a captured pre-change response
- [ ] 8.6 The supervisor SPA still loads, logs in, and renders a past day
- [ ] 8.7 A 16:30 refresh costs 0 USD — check `runs.totalCostUsd` is untouched
- [ ] 8.8 Panel renders correctly as a full page in the Desk topband view and in a standalone browser tab
- [ ] 8.9 From a cold Desk session, the agent reaches their panel in exactly one click and sees no login screen
- [ ] 8.10 Reopening the bookmarked dashboard URL within 8 hours lands straight on the panel
- [ ] 8.11 Inside any iframe, confirm no cookie is set — the bearer token is the only mechanism

## QA — independent validation

> This change is implemented under `.claude/skills/implementation-qa-handoff/SKILL.md`.
> Claude Code is the builder. It does not approve its own work.

- [ ] Q.1 After **each** numbered section above, produce a QA handoff in the format the skill prescribes and write it to `qa-handoff/<section>.md`
- [ ] Q.2 Use the `#### Scenario:` blocks in `specs/supervisor/spec.md` verbatim as the acceptance criteria — do not paraphrase them and do not add your own
- [ ] Q.3 State plainly, per scenario, whether it was actually exercised or only implemented. "Not verified" is an acceptable answer; a false "done" is not
- [ ] Q.4 Hand off to the independent QA agent. Final status is **READY FOR INDEPENDENT QA**, never approved or done
- [ ] Q.5 Defects come back as a new section of tasks, fixed at root cause with a regression test that would have failed before the fix, then returned for retest
- [ ] Q.6 Archive this change folder only after independent QA returns PASS

## 9. Close out

- [ ] 9.1 Demo to Rui with real data, one agent and the supervisor view
- [ ] 9.2 Only after Rui confirms the panel is in daily use, open a separate change to turn off the 06:00 individual email and the automatic task creation
- [ ] 9.3 Merge the delta into `openspec/specs/supervisor/spec.md` and archive this folder
