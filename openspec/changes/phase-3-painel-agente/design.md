# Design: Phase 3 — Painel do agente embebido no Zoho Desk

## Architecture overview

The panel is a **full-page dashboard**, not a side panel. Where it can be embedded full-page differs by product, and that constraint drives the whole shape below.

```
Zoho CRM  ── Web Tab (widget, external hosting) ─────────────┐
             ZOHO.embeddedApp.init()                         │
             ZOHO.CRM.CONFIG.getCurrentUser()                │
                                                             │
Zoho Desk ── desk.topband widget = launcher only ────────────┤
             ZOHODESK.get("user") / ZOHODESK.get("portal")   │
             opens the dashboard in a new browser tab        │
                                                             ▼
                              POST /api/agente/sessao   (X-Painel-Widget-Token)
                              │  validate org/portal, resolve colaborador, check ativo
                              ▼
                              { token }  short-lived JWT, 15 min
                              │
                              └── https://<app>/agente#token=...   (full page)
                                        │
                                        └── artifacts/agente (React SPA)
                                              └── GET /api/agente/painel  (Bearer)
                                                    ├── devolucoes       (Ringover missed calls)
                                                    ├── tickets em risco (tickets table, synced)
                                                    └── follow-ups       (conversations analysisJson)
```

Nothing above touches `artifacts/supervisor`, `requireAuth`, `usersTable`, or any existing route.

## Decisions

### Decision: Zoho CRM Web Tab is the home of the full-page dashboard; Zoho Desk gets a launcher

This was checked against the platform documentation before designing anything, because it is the constraint everything else hangs off.

**Zoho Desk cannot host a full-page dashboard.** Its extension widget locations are: right panels, left vertical strips, more-action panels, blueprint transitions, `desk.bottomband`, and `desk.topband`. The `*.detail.subtab` locations do fill the content area, but only *inside a ticket, contact or account record* — the wrong place for "what must I do today". `desk.topband` is full screen **width** but is a band, and the `MAXIMIZE` UI method is available only to `desk.bottomband` and `desk.extension.telephony`. Zoho Desk has no Web Tabs feature. There is no arrangement of these that yields a full page.

**Zoho CRM can.** CRM supports Web Tabs as a widget location, with **External** hosting — the widget points at our own URL — and the CRM JS SDK is available inside it, so identity works the same way. That is a real full-page tab in the CRM's top menu.

Therefore:

- **Zoho CRM Web Tab** — the dashboard, full page. This is the primary surface.
- **Zoho Desk `desk.topband`** — a slim band with one button, "O meu painel". It mints the token and opens the dashboard in a new browser tab. The agent gets there in one click from Desk, and the dashboard is a real full page rather than a squeezed panel.

This also matches where the work is going: Plan §8.2 moves the equipa 360 into the CRM. Putting the daily panel in the CRM is with the grain, not against it.

**Risk to confirm before building:** the equipa 360 agents must have CRM user accounts with a licence that allows Web Tabs. The Plan says the CRM exists but is poorly configured and the team barely uses it. Confirm licences with Rui as task 0.6. If it turns out they do not have CRM access, the fallback is Desk topband launcher only — which still works, still identifies the agent, and still opens a full page; the panel just lives at our URL rather than inside a Zoho chrome.

### Decision: Identity comes from the Zoho JS SDK, not from cookies

Cookies do not work here. The panel runs in a third-party iframe inside Desk. Chrome partitions third-party cookies by top-level site, so a `sid` cookie set on our origin is not the cookie the iframe sees, and in stricter configurations it is not set at all. Any design that leans on the existing session cookie will work in testing and fail intermittently in production, which is the worst possible failure mode.

Both platforms give the identity directly. In Desk, `ZOHODESK.get("user")` returns `id`, `fullName`, `email`, `timeZone` and `portals` for the logged-in agent from any widget location, and `ZOHODESK.get("portal")` returns the portal `id`. In CRM, `ZOHO.embeddedApp.init()` followed by `ZOHO.CRM.CONFIG.getCurrentUser()` returns the logged-in CRM user. Either is enough.

The token endpoint accepts both shapes and records which surface the request came from.

### Decision: Zero clicks, zero passwords — the agent never authenticates

Hard requirement from Nuno: identification must be as seamless as possible for the end user, and should ride on session information the browser already has.

The design meets this without compromise, because the Zoho JS SDK *is* that session information. The agent is already logged into Zoho. The widget reads who they are and exchanges it for a token in the background, before the first paint. There is no login screen, no password, no consent click, no "which agent are you" dropdown. If the agent is not recognised, the panel says so with their email on screen — it never falls back to asking them to log in.

Three surfaces, one behaviour:

| Surface | Context | How the session is carried |
|---|---|---|
| CRM Web Tab | third-party iframe | in-memory bearer token from the SDK, re-minted silently every 15 min |
| Opened from the Desk topband button | new browser tab, **first-party** | same mint, plus a first-party session cookie |
| Bookmarked or reopened later | new browser tab, first-party | the cookie from the previous open |

**The cookie only exists on the first-party path**, and that is what makes a bookmark work. When the dashboard is opened as a top-level page rather than in an iframe, our origin is first-party, so a normal `httpOnly; Secure; SameSite=Lax` cookie behaves normally — none of the partitioning problems that rule cookies out inside the iframe. Set it for 8 hours when a token is redeemed from a top-level navigation, and a returning agent lands straight on their panel.

Inside the CRM iframe the cookie is neither set nor read. The bearer token is the only mechanism there. Do not try to make one mechanism serve both contexts — that is how this breaks in production.

**Cold open with no token and no cookie** (someone pastes the URL on a new machine): show a single button, "Entrar com o Zoho", which starts a Zoho OAuth sign-in. One click, no password, because they are already signed into Zoho. This is the only path that costs the agent an interaction, and it exists purely so the page is never a dead end.

### Decision: The token travels in the URL fragment, not the query string

`/agente#token=...` rather than `/agente?token=...`. The fragment is never sent to the server, so the token does not land in access logs, in `Referer` headers, or in any proxy in between. The SPA reads it from `location.hash` on boot, keeps it in memory, and clears the hash immediately.

### Decision: A short-lived bearer token, held in memory only

15-minute HS256 JWT signed with `AGENT_TOKEN_SECRET`. Claims: `sub` = colaborador id, `zid`, `papel`, `exp`, `iat`.

Not stored in `localStorage` or `sessionStorage` — partitioned storage in an iframe is another source of intermittent failure, and a token in memory dies with the tab, which is the behaviour we want. The widget re-mints silently before expiry.

### Decision: `colaboradores` is the identity table, not `users`

`colaboradores` already has exactly the right columns: `zid` (the Zoho Desk agent id), `email`, `equipa`, `ativo`. `usersTable` is the supervisor app's own login for Nuno and Rui, with roles `admin | viewer`, and has nothing to do with the agents.

Resolution order when minting a token:

1. `colaboradores.zid == deskUserId` — the reliable key
2. fallback `lower(colaboradores.email) == lower(deskEmail)` — for rows where `zid` was never backfilled
3. no match, or `ativo = false` → 403, and log it

Backfilling `zid` for the nine 360-team agents is a task in this change, not an assumption.

### Decision: A new `papel` column rather than reusing `equipa`

`equipa` says which team someone is on. `papel` says which panel they get. They are different questions — the supervisor is also on a team. Add `papel` as `text` with enum `agente | supervisor | nenhum`, default `agente`.

### Decision: A separate frontend artifact, not new routes in the supervisor SPA

`artifacts/supervisor/src/App.tsx` gates every route behind `AuthProvider` → `Login`. Adding `/agente` inside it means restructuring that gate, which is exactly the kind of change the brief rules out.

`artifacts/agente` is a second Vite build with `BASE_PATH=/agente/`, its own auth context (bearer, not session), and its own layout. It reuses `@workspace/api-client-react` and `@workspace/api-zod` unchanged.

**Accepted cost:** the shadcn primitives under `artifacts/supervisor/src/components/ui/` are duplicated into the new artifact for the handful actually needed (card, badge, button, tabs, skeleton, separator, tooltip). Extracting them into a shared `lib/ui` package would mean rewriting imports across the existing app — a change we are not allowed to make. Note this as debt; extract later when the supervisor app is next open for work anyway.

### Decision: New routes mount before `requireAuth`, with their own guard

In `routes/index.ts`, `agenteRouter` and `supervisorPainelRouter` go in the block above `router.use(requireAuth)`, alongside the other externally-called routers. They are guarded by `requireAgent` / `requireSupervisor`, which validate the bearer JWT. `requireAuth` and every route below it is untouched.

### Decision: The 16:30 refresh costs nothing

The 08:00 run is the existing `/api/run` — Ringover fetch plus LLM analysis of the previous day. The 16:30 refresh is a new `POST /api/painel/refresh` that recomputes **only** the derived panel state: today's missed calls from Ringover, open-ticket ages from the already-synced `tickets` table, and follow-up staleness. No LLM call. Cost discipline is a stated principle of this codebase and a second full analysis per day would roughly double the bill for no new insight.

### Decision: Missed calls get their own table

A missed call needs state that Ringover cannot hold: was it returned, by whom, when, and was it dismissed as not worth returning. `devolucoes` stores that, keyed by Ringover call id, and is idempotently upserted by the refresh job. Auto-resolution: an outbound call to the same normalised number after the miss closes it without anyone clicking anything. `@workspace/phone` already provides the normalisation.

### Decision: Agendamentos and renovações show an empty state, not fake data

The Plan lists them as panel blocks. They live in the CRM and the CRM 360 migration has not happened. Rendering a plausible-looking empty block trains the team to ignore the panel. Render an explicit "disponível após a migração para o CRM" placeholder instead.

## Threat model, stated honestly

`X-Painel-Widget-Token` is a shared secret baked into the extension bundle. Zoho serves that bundle only to logged-in agents of this portal, so it is not public — but it is not a per-user secret either. An agent who opens devtools could extract it and mint a token naming a colleague.

What that gets them: read-only sight of a colleague's call-back list and ticket ages. What it does not get them: any write, any customer data they cannot already see in Desk, and any access to the supervisor view unless that colleague has `papel = supervisor`.

Controls in this change:

- Portal id must match `ZOHO_DESK_ORG_ID` (683863304)
- Target must exist in `colaboradores` with `ativo = true`
- Every mint is logged with the requested identity, so impersonation is visible after the fact
- Rate limit on `/api/agente/sessao`
- 15-minute expiry
- Read-only endpoints only

For a nine-person internal team this is proportionate. If Rui wants it stronger, the upgrade path is a Zoho OAuth sign-in in a top-level popup on first use, which gives a cryptographically verified identity — more moving parts, and worth doing only if the requirement is real. Do not build it speculatively.

## Panel data sources

| Block | Source | Already exists? |
|---|---|---|
| Chamadas por devolver | Ringover calls for today, inbound, unanswered, minus auto-resolved, minus dismissed | Ringover client exists; `devolucoes` table is new |
| Tickets em risco | `tickets` table, open, `createdAt < now - 24h`, assignee `zid` = agent | Sync job exists (`jobs/sync-tickets.ts`) |
| Follow-ups | `conversations.analysisJson->>'followUpNecessario' = 'true'`, minus `follow_up_acks`, filtered to agent | Logic exists in `routes/followups.ts` — extract to a shared function, do not duplicate |
| Alerta 16h30 | The three above, filtered to "still outstanding" | New |
| Agendamentos / renovações | CRM — not available | Placeholder |
| Supervisor totals | Aggregate of the above across `colaboradores` where `equipa = '360'` | New |

The follow-ups logic must be **extracted** from `routes/followups.ts` into `src/painel/followups-query.ts` and called by both. `routes/followups.ts` keeps its existing response shape exactly — n8n depends on it.

## Zoho Desk extension shape

- Built with Sigma (`zet` CLI), `plugin-manifest.json`
- One widget, location: left panel (`ticket.leftpanel` for in-ticket context, plus a top-band tab for the standalone panel — confirm the exact location keys against the Sigma manifest schema during implementation, they change between versions)
- The widget HTML is ~40 lines: load the Desk JS SDK, `ZOHODESK.extension.onload()`, read user and portal, POST for a token, set the iframe `src`, set a timer to re-mint
- The app domain must be added to the extension's allowed domains in the manifest, or the iframe is blocked
- Distribution: private extension installed into the Alfaseguros portal, not the marketplace

## Files to create or modify

**New:**

| Path | Purpose |
|---|---|
| `lib/db/src/schema/devolucoes.ts` | missed-call state |
| `artifacts/api-server/src/painel/token.ts` | mint + verify the agent JWT |
| `artifacts/api-server/src/painel/identity.ts` | resolve Desk user → colaborador |
| `artifacts/api-server/src/painel/devolucoes.ts` | compute + upsert missed calls |
| `artifacts/api-server/src/painel/followups-query.ts` | shared follow-up query |
| `artifacts/api-server/src/painel/agente.ts` | assemble the agent panel payload |
| `artifacts/api-server/src/painel/supervisor.ts` | assemble the team payload + redistribution suggestion |
| `artifacts/api-server/src/middleware/require-agent.ts` | bearer guard |
| `artifacts/api-server/src/routes/agente.ts` | `/api/agente/*` |
| `artifacts/api-server/src/routes/painel-supervisor.ts` | `/api/supervisor/*` |
| `artifacts/api-server/src/routes/painel-refresh.ts` | `POST /api/painel/refresh`, cron-secret guarded |
| `artifacts/agente/**` | new Vite + React SPA |
| `extension/zoho-desk/**` | Sigma extension source |

**Modified (additively only):**

| Path | Change |
|---|---|
| `lib/db/src/schema/colaboradores.ts` | add `papel` column |
| `lib/db/src/schema/index.ts` | export the new table |
| `artifacts/api-server/src/routes/index.ts` | mount three new routers above `requireAuth` |
| `artifacts/api-server/src/routes/followups.ts` | call the extracted query; response shape unchanged |
| `artifacts/api-server/src/lib/env.ts` | add `AGENT_TOKEN_SECRET`, `PAINEL_WIDGET_TOKEN`, `AGENTE_APP_URL` |
| `artifacts/api-server/src/app.ts` | static serving for the second SPA under `/agente` |
| `lib/api-spec/openapi.yaml` | new endpoints, then run codegen |

**Explicitly not modified:** `artifacts/supervisor/**`, `middleware/require-auth.ts`, `routes/auth.ts`, `schema/users.ts`, every existing `/api` response shape.
