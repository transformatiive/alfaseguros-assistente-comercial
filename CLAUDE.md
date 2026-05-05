# Claude Code Instructions — Alfaseguros Supervisor Virtual

> **Read [`CONTEXT.md`](./CONTEXT.md) first** — it covers the *why* (the client, the problems, what good looks like). [`HANDOVER.md`](./HANDOVER.md) covers technical findings (API behaviours, design rationale, UI spec). This file covers the *how* (folder map, conventions, common tasks). Read all three before changing anything significant.

> **For active scope and behaviour requirements, see [`openspec/`](./openspec/).** That folder is the source of truth for what the system does (`specs/`) and what we plan to change (`changes/`). When in doubt about whether a requirement applies today or is in-flight, the OpenSpec delta-spec format makes it unambiguous.

> This file tells Claude Code how to navigate, extend, and maintain this project. Read it before making any changes.

## What this is

Daily AI-powered analysis of phone conversations from Alfaseguros (Portuguese insurance broker), Não Vida / 360 team. For each conversation (which may span multiple calls), an LLM produces:
- A narrative summary of the end-to-end interaction
- Procedural deviation flags
- Coaching feedback for the operator(s)
- Specialist suggestions
- Risk / follow-up assessment

A daily executive summary is generated for the supervisor.

The system runs on **Replit**, persists to **Postgres**, calls **OpenRouter** (Claude Sonnet 4 by default) for analysis, and exposes a **React UI** for browsing.

## Architecture at a glance

```
Ringover API ─► fetchCallsForDate ─► filterAnalyzable ─► groupIntoConversations
                                                              │
                                                              ▼
                                          ┌─── upsertConversation (Postgres)
                                          │
                                          ▼
                          analyzeConversation (OpenRouter + Zod validation)
                                          │
                                          ▼
                            saveAnalysis (Postgres)
                                          │
                                          ▼
                     generateDailySummary ─► saveDailySummary
                                          │
                                          ▼
                            Express API ─► React UI (SSE for live progress)
```

## Folder map

| Path | Purpose |
|------|---------|
| `src/server.ts` | Express entry. Mounts `/api/*` and serves built UI in production. |
| `src/cli.ts` | CLI entry for manual / cron invocation. |
| `src/api/routes.ts` | REST + SSE endpoints. |
| `src/ringover/` | Ringover API client + types. |
| `src/grouping/conversations.ts` | Groups raw Ringover calls into conversations by customer number. |
| `src/analysis/prompts.ts` | System prompt + user message builders. Loads `procedures.md`. |
| `src/analysis/schema.ts` | Zod schemas (analysis, daily summary, agent analysis). **All Claude output is validated against these.** |
| `src/analysis/openrouter.ts` | OpenRouter client with retry, prompt caching, cost estimation. |
| `src/analysis/analyzer.ts` | Single-conversation analysis. |
| `src/analysis/summarizer.ts` | Daily executive summary — produces 5 structured sections (working_well, to_improve, risks, closing_rate_recommendations, automation_opportunities). |
| `src/analysis/agent-summarizer.ts` | Per-operator coaching summary. One pass per agent active that day. |
| `src/jobs/analyze-day.ts` | Orchestrator — fetch, group, analyze (with cache), daily summary, per-agent. |
| `src/jobs/sync-tickets.ts` | **Phase 2A**: pulls Zoho Desk tickets + comments into Postgres. |
| `src/jobs/bus.ts` | Per-date EventEmitter for SSE progress events. |
| `src/zoho-desk/client.ts` | **Phase 2A**: Zoho Desk REST client (lists tickets, fetches comments). |
| `src/zoho-desk/auth.ts` | **Phase 2A**: Zoho Self-Client OAuth refresh-token cache. |
| `src/cases/linker.ts` | **Phase 2A**: joins calls + tickets into cross-channel "cases". |
| `src/analysis/outcome.ts` | **Phase 2A**: classifies a ticket into won/lost/open/unknown. **Currently has placeholder rules — must be wired up to Alfaseguros' actual cf_* fields.** |
| `src/probe-tickets.ts` | **Phase 2A**: diagnostic CLI that prints ticket/cf_* schema. Use this to inspect real tickets and update `outcome.ts`. |
| `src/cli-sync-tickets.ts` | **Phase 2A**: manual CLI to sync tickets for a window. |
| `src/lib/phone.ts` | Phone number normalization across Ringover (digits-only) and Zoho Desk (free-form). |
| `src/storage/db.ts` | Prisma client singleton. |
| `src/storage/repo.ts` | All DB read/write operations. **Do not import Prisma elsewhere.** |
| `src/lib/env.ts` | Validated env access. **Never read `process.env` directly elsewhere.** |
| `src/lib/logger.ts` | Structured logger. **Never use `console.log` in committed code.** |
| `src/lib/dates.ts` | Date utilities (Lisbon-aware). |
| `src/procedures/procedures.md` | The strawman procedures manual fed into the system prompt. |
| `src/ui/` | Vite + React app. Self-contained. |
| `prisma/schema.prisma` | Postgres schema. |

## Conventions

### TypeScript
- **Strict mode is on**. No `any` without an explicit comment justifying it.
- Prefer functions over classes for stateless logic.
- All async functions return `Promise<T>` with an explicit `T`.
- Imports use the `.js` suffix (Node ESM requires this even for `.ts` source files).

### External boundaries
- Every value coming from outside the process (HTTP requests, env vars, LLM output, DB JSON columns) is validated with Zod before use. See `src/analysis/schema.ts` and `src/lib/env.ts` for examples.
- Never trust LLM JSON output without `analysisSchema.safeParse`.

### Database
- All Prisma access lives in `src/storage/repo.ts`. **Other modules must not import `prisma` directly.** This makes the storage layer easy to swap later.
- Migrations: `npm run db:migrate` (dev) / `npm run db:deploy` (prod).
- Schema changes require a migration; never edit `schema.prisma` without running `db:migrate`.

### Logging
- Use `import { log } from "./lib/logger"`. Never `console.log` in committed code.
- Log structured: `log.info("event happened", { key: value })`.
- `log.error` for genuinely unexpected failures only — operational outcomes (rate limit, cache hit) are `log.info` or `log.warn`.

### Cost discipline
- All OpenRouter calls track tokens + cost via `estimateCost()`. The per-conversation cost is persisted on the `Conversation` row; the per-run total on the `Run` row.
- **Cache by default.** A conversation that has `analysisJson` set is never re-analyzed unless `force=true` or the customer number is in `forceCustomerNumbers`. This is the budget guardrail.
- The system prompt uses `cache_control: { type: "ephemeral" }` so prompt-caching kicks in on the second+ call within a 5-minute window. This drops cost ~80% across a full-day run.

### UI
- The UI is in `src/ui/`. Vite dev server proxies `/api` to the Express server in dev. In production, Express serves the built static files from `dist/ui`.
- All UI types are in `src/ui/types.ts`. Keep them in sync with the API DTOs in `src/api/routes.ts`.
- The artifact look-and-feel (warm neutral palette, Georgia for narrative blocks, dense information design) is intentional. Don't move to a generic component library.

## Common tasks

### Run locally
```bash
cp .env.example .env       # fill in keys
npm install
npx prisma migrate dev      # creates DB schema
npm run dev                 # runs server + UI together
```
Open http://localhost:5173.

### Analyze a specific day from CLI
```bash
npm run analyze:cli -- --date=2026-04-30
npm run analyze:cli -- --date=2026-04-30 --force   # ignore cache
```

### Add a new analysis field
1. Update the Zod schema in `src/analysis/schema.ts`.
2. Update the system prompt in `src/analysis/prompts.ts` to instruct the LLM to produce it.
3. Update the UI type in `src/ui/types.ts`.
4. Update the `ConversationCard` component to display it.
5. Run `npm run db:migrate -- --name added_x_field` only if the field needs to be queryable — JSON-column fields don't require migrations.

### Add a new output channel (e.g., post to Zoho Desk)
1. Create `src/outputs/desk-poster.ts` with a single export `postFeedbackToDesk(conv, analysis)`.
2. Wire it into `src/jobs/analyze-day.ts` after `saveAnalysis`, gated by an env flag (`OUTPUT_DESK_ENABLED`).
3. Add the env var to `src/lib/env.ts` and `.env.example`.
4. Update this file with the new convention.

### Update the procedures manual
- The strawman lives at `src/procedures/procedures.md`.
- When Soraia provides the real manual, replace this file. The system prompt loads it at startup; restart the server to pick up changes.
- **Force a full re-analysis after updating procedures**: from the UI, click "⟲ Re-analisar tudo (força)" or run CLI with `--force`.

### Change the LLM model
Set `OPENROUTER_MODEL` in `.env`. Defaults to `anthropic/claude-sonnet-4`. Other useful options:
- `anthropic/claude-3.5-haiku` — cheaper, faster, less nuanced
- `anthropic/claude-opus-4` — slower, smarter

## Cron trigger setup (n8n)

A daily cron is triggered from the existing n8n instance on Railway, hitting:

```
POST https://<replit-url>/api/run
Headers:
  Content-Type: application/json
  X-Cron-Secret: <CRON_WEBHOOK_SECRET>
Body (one of):
  { "date": "2026-04-30", "source": "cron" }     # explicit date
  { "date_offset": -1, "source": "cron" }         # 1 day ago (default if omitted)
  { "date_offset": -3, "source": "cron" }         # 3 days ago — useful for catching up after a holiday
  { "source": "cron" }                            # defaults to yesterday (Lisbon time)
```

Resolution order: `date` (if valid) → `date_offset` (if numeric) → yesterday (Lisbon).

The endpoint authorizes via the `X-Cron-Secret` header (matched against the env var of the same name).

**Recommended cron schedule**: 07:00 Lisbon, Monday–Saturday. Skip Sunday (no calls Saturday). After a public holiday, manually trigger with `date_offset: -2` to catch the previous workday.

## Known gotchas

- **Public holidays in Portugal** (1 May, 25 Apr, 10 Jun, etc.) have very few or no calls. The system handles this gracefully (creates an empty Run with status "done"), but the daily summary will be terse.
- **Hélio Vazão (Ringover user_id 23185416)** is on the Vida team, which is out of scope. He's hard-filtered in `grouping/conversations.ts` (constant `VIDA_AGENT_IDS`). When new agents join, you may need to update this set.
- **Alfaseguros has 4 inbound numbers** (`351215832338`, `351210270858`, `351210270860`, `351210270869`). Calls to/from any of them are normal; the customer number is always the *other* end of the call.
- **Ringover's `note` field is the AI-generated summary**, not a verbatim transcript. About 39% of all calls and 72% of answered calls have one. Calls without a `note` are filtered out (no signal to analyze).
- **`p-queue` concurrency is 4.** Lower if rate limits become an issue. Higher will likely hit OpenRouter rate limits.

## Phase 2A — Zoho Desk integration (work in progress)

This phase extends the system to merge calls with Zoho Desk tickets into **cases** — the unit that captures a full customer engagement across channels (phone, email, ticket comments).

### What's done (in this codebase)

- Postgres models: `Ticket`, `TicketComment`, `Case`, `CaseTicket`, `CaseCall`, `TicketSyncState`
- Zoho Desk OAuth refresh-token client (Self-Client flow, US datacenter)
- `listTicketsCreatedBetween`, `listTicketComments` — fetch with pagination
- `syncTickets(from, to)` job — idempotent upsert into Postgres
- Phone normalization (Ringover digits ↔ Desk free-form)
- `buildCases({ calls, tickets, comments })` — links by phone fingerprint within ±14d proximity
- `classifyOutcome(ticket)` — **stub** with placeholder rules; see TODO below
- Diagnostic CLI: `npm run zoho:probe-tickets -- --days=7 --limit=20`

### What's NOT done — explicit TODOs

1. **Wire up `classifyOutcome` to real custom fields.** The current rules are heuristic guesses. To fix: in Claude Code locally, run `npm run zoho:probe-tickets`, examine which `cf_*` fields exist, and ask the user to map field/value combinations to outcomes (won/lost/open/unknown). Then replace the rules in `src/analysis/outcome.ts`.
2. **Case-level analyzer.** The current `analyzer.ts` analyzes call-only conversations. A new `analyzeCase()` function is needed that takes the full case (calls + ticket events + comments) and produces a richer narrative including the email exchanges. The Zod schema can stay similar; the user-message builder needs updating.
3. **Pipeline view UI.** A third toggle (`Visão Geral / Por Operador / Pipeline`) showing all cases for a date range with outcome status, days since last touch, owner, etc.
4. **Cron extension.** The daily run should sync tickets for the previous N days before analyzing. Add to `analyzeDay()` orchestrator.
5. **Lead temperature classification.** Once cases are in, add `temperatura_lead` field to the case analysis schema.

### Setup steps for the user

The user needs to set up a Zoho Self-Client (one-time) to get a refresh token. Walk them through:
1. Visit https://api-console.zoho.com/ → Self Client tab
2. Generate code with scope: `Desk.tickets.READ Desk.contacts.READ Desk.search.READ Desk.basic.READ`
3. Exchange the auth code for a refresh token via curl POST to `https://accounts.zoho.com/oauth/v2/token`
4. Set Replit secrets: `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ORG_ID=683863304`
5. Test: `npm run zoho:probe-tickets`

### Why this architecture

- **Tickets as the case anchor.** Each Desk ticket = one case (most natural unit, matches Alfaseguros' actual workflow). Calls without a ticket form orphan single-call cases that can later be merged if a ticket appears.
- **±14 day proximity for call-to-ticket linking.** Generous enough to catch follow-ups, tight enough not to merge unrelated cases for the same customer.
- **Phone fingerprint = last 9 digits.** Matches Ringover's `351...` format with Desk's free-text `+351 911 ...`.
- **Outcome classification is rule-based, not AI.** Faster, cheaper, deterministic. The AI is reserved for the per-case narrative analysis.

## Testing

`npm test` runs Vitest unit tests. Tests are colocated as `*.test.ts` next to the file being tested. Priorities for new test coverage:
1. `grouping/conversations.test.ts` — phone normalization, multi-leg detection, edge cases (3+ legs, mixed agents).
2. `analysis/schema.test.ts` — schema accepts all valid LLM responses, rejects malformed ones.
3. `lib/dates.test.ts` — Lisbon timezone correctness across DST.
