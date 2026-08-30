# Claude Code Instructions — Alfaseguros Supervisor Virtual

> **Read [`CONTEXT.md`](./CONTEXT.md) first** — it covers the *why* (the client, the problems, what good looks like). [`HANDOVER.md`](./HANDOVER.md) covers technical findings (API behaviours, design rationale, UI spec). This file covers the *how* (folder map, conventions, common tasks). Read all three before changing anything significant.

> **For active scope and behaviour requirements, see [`openspec/`](./openspec/).** That folder is the source of truth for what the system does (`specs/`) and what we plan to change (`changes/`). When in doubt about whether a requirement applies today or is in-flight, the OpenSpec delta-spec format makes it unambiguous.

> This file tells Claude Code how to navigate, extend, and maintain this project. Read it before making any changes.

> **Every code change in this repo runs under `.claude/skills/implementation-qa-handoff/SKILL.md`.** Claude Code implements and tests; an independent QA agent validates and accepts. The terminal state of any implementation or bug-fix task is **READY FOR INDEPENDENT QA** — never approved, done, or production-ready.

## What this is

Daily AI-powered analysis of phone conversations from Alfaseguros (Portuguese insurance broker), Não Vida / 360 team. For each conversation (which may span multiple calls), an LLM produces:
- A narrative summary of the end-to-end interaction
- Procedural deviation flags
- Coaching feedback for the operator(s)
- Specialist suggestions
- Risk / follow-up assessment

A daily executive summary is generated for the supervisor.

The system runs on **Replit**, persists to **Postgres** via **Drizzle ORM**, calls **OpenRouter** (Claude Sonnet 4 by default) for analysis, and exposes a **React UI** for browsing.

## Stack at a glance

- **Monorepo**: pnpm workspaces (Node 24, TypeScript 5.9 strict)
- **API**: Express 5 (`artifacts/api-server`)
- **DB**: Postgres + Drizzle ORM (`lib/db`)
- **Validation / API contract**: OpenAPI spec (`lib/api-spec/openapi.yaml`) → Orval codegen → Zod (`lib/api-zod`) + typed React Query hooks (`lib/api-client-react`)
- **Frontend**: Vite + React + TanStack Query + Tailwind + Wouter (`artifacts/supervisor`)
- **Build**: esbuild (CJS bundle for the API), Vite (UI)
- **External services**: Ringover (calls), Zoho Desk (tickets, Phase 2A), OpenRouter (LLM)

## Architecture at a glance

```
Ringover API ─► fetchCallsForDate ─► filterAnalyzable ─► groupIntoConversations
                                                              │
                                                              ▼
                                          ┌─── upsertConversation (Postgres / Drizzle)
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

The repo is a pnpm workspace. Top-level layout:

| Path | Purpose |
|------|---------|
| `lib/api-spec/` | OpenAPI source of truth (`openapi.yaml`) + Orval config |
| `lib/api-zod/` | Generated Zod schemas + types (do not edit by hand; regenerate) |
| `lib/api-client-react/` | Generated typed React Query hooks (do not edit by hand) |
| `lib/db/` | Drizzle schema (`src/schema/*.ts`), client, type exports |
| `lib/ringover/` | **(planned)** Ringover REST client + types |
| `lib/zoho-desk/` | **(planned, Phase 2A)** Zoho Desk OAuth + REST client |
| `lib/openrouter/` | **(planned)** OpenRouter client with retry, prompt caching, cost estimation |
| `artifacts/api-server/` | Express 5 REST API (mounts `/api/*`) |
| `artifacts/api-server/src/routes/` | REST handlers |
| `artifacts/api-server/src/grouping/` | **(planned)** group raw calls into conversations |
| `artifacts/api-server/src/analysis/` | **(planned)** prompts, analyzer, summarizer, agent-summarizer, outcome classifier |
| `artifacts/api-server/src/jobs/` | **(planned)** `analyze-day.ts` orchestrator, `sync-tickets.ts`, SSE bus |
| `artifacts/api-server/src/cases/` | **(planned, Phase 2A)** `linker.ts` — joins calls + tickets into cases |
| `artifacts/api-server/src/lib/` | **(planned)** env, logger, dates, phone normalization |
| `artifacts/api-server/src/procedures/procedures.md` | **(planned)** strawman procedures fed into the system prompt |
| `artifacts/supervisor/` | Vite + React frontend (serves `/`) |
| `artifacts/supervisor/src/pages/` | Page components — dashboard, conversa-detalhe, operadores |
| `artifacts/supervisor/src/components/ui/` | shadcn-style primitives |
| `artifacts/mockup-sandbox/` | Component preview sandbox (not user-facing) |
| `scripts/` | Repo-wide utility scripts |

> Items marked **(planned)** are referenced throughout this doc and in OpenSpec but not yet present in the repo. They will be created during the Phase 1 / Phase 2A implementation work.

## Conventions

### TypeScript
- **Strict mode is on**. No `any` without an explicit comment justifying it.
- Prefer functions over classes for stateless logic.
- All async functions return `Promise<T>` with an explicit `T`.

### External boundaries
- Every value coming from outside the process (HTTP requests, env vars, LLM output, DB JSON columns) is validated with Zod before use.
- Never trust LLM JSON output — always `safeParse` against the analysis schema.
- The HTTP API contract lives in `lib/api-spec/openapi.yaml`. After editing it, run `pnpm --filter @workspace/api-spec run codegen` to regenerate the Zod schemas and React Query hooks.

### Database
- All Drizzle access lives in a thin repo layer (planned: `artifacts/api-server/src/storage/repo.ts`). Other modules SHOULD NOT import the Drizzle client directly. This keeps the storage layer easy to swap later.
- Schema changes: edit a file in `lib/db/src/schema/`, then run `pnpm --filter @workspace/db run push` (dev) to apply via `drizzle-kit push`. There are no SQL migration files committed yet — Drizzle introspects + pushes.

### Logging
- Use a structured logger (planned at `artifacts/api-server/src/lib/logger.ts`). Never `console.log` in committed code.
- Log structured: `log.info("event happened", { key: value })`.
- `log.error` for genuinely unexpected failures only — operational outcomes (rate limit, cache hit) are `log.info` or `log.warn`.

### Cost discipline
- All OpenRouter calls track tokens + cost via `estimateCost()`. The per-conversation cost is persisted on the `Conversation` row; the per-run total on the `Run` row.
- **Cache by default.** A conversation that has `analysisJson` set is never re-analyzed unless `force=true` or the customer number is in `forceCustomerNumbers`. This is the budget guardrail.
- The system prompt uses `cache_control: { type: "ephemeral" }` so prompt-caching kicks in on the second+ call within a 5-minute window. This drops cost ~80% across a full-day run.

### UI
- All UI types come from `@workspace/api-zod` (Zod-inferred) + `@workspace/api-client-react` (typed hooks). Don't define parallel DTO types in the UI.
- The artifact look-and-feel (warm neutral palette, Georgia for narrative blocks, dense information design) is intentional and described in `HANDOVER.md` §3. Don't simplify.

## Common tasks

### Run locally
```bash
pnpm install
pnpm --filter @workspace/db run push      # creates / updates DB schema
pnpm --filter @workspace/api-server run dev    # API on :3000
pnpm --filter @workspace/supervisor run dev    # UI on :5173 (proxies /api)
```
Open http://localhost:5173.

### Typecheck and build the whole repo
```bash
pnpm run typecheck
pnpm run build
```

### Regenerate API hooks + Zod after editing the OpenAPI spec
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Analyze a specific day from CLI (planned)
```bash
pnpm run analyze:cli -- --date=2026-04-30
pnpm run analyze:cli -- --date=2026-04-30 --force   # ignore cache
```

### Add a new analysis field
1. Edit the OpenAPI schema in `lib/api-spec/openapi.yaml` (e.g. add a property under `ConversationAnalysis`).
2. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate Zod + hooks.
3. Update the system prompt to instruct the LLM to produce it.
4. Update the conversation detail page to display it.
5. If the field needs to be queryable (not just stored in `analysis_json`), add a Drizzle column in `lib/db/src/schema/conversations.ts` and run `pnpm --filter @workspace/db run push`.

### Add a new output channel (e.g., post to Zoho Desk)
1. Create a new module under `artifacts/api-server/src/outputs/desk-poster.ts` with a single export `postFeedbackToDesk(conv, analysis)`.
2. Wire it into the daily orchestrator after `saveAnalysis`, gated by an env flag (e.g. `OUTPUT_DESK_ENABLED`).
3. Add the env var to your env validator and `.env.example`.
4. Update this file with the new convention.

### Update the procedures manual
- The strawman lives at `artifacts/api-server/src/procedures/procedures.md` (planned).
- When Soraia provides the real manual, replace this file. The system prompt loads it at startup; restart the server to pick up changes.
- **Force a full re-analysis after updating procedures**: from the UI, click "⟲ Re-analisar tudo (força)" or run the CLI with `--force`.

### Change the LLM model
Set `OPENROUTER_MODEL` in env. Defaults to `anthropic/claude-sonnet-4`. Other useful options:
- `anthropic/claude-3.5-haiku` — cheaper, faster, less nuanced
- `anthropic/claude-opus-4` — slower, smarter

## Cron trigger setup (n8n)

A daily cron is triggered from the existing n8n instance on Railway, hitting:

```
POST https://<replit-url>/api/run
Headers:
  Content-Type: application/json
  X-Cron-Secret: <CRON_SECRET>
Body (one of):
  { "date": "2026-04-30", "source": "cron" }     # explicit date
  { "date_offset": -1, "source": "cron" }         # 1 day ago (default if omitted)
  { "date_offset": -3, "source": "cron" }         # 3 days ago — useful for catching up after a holiday
  { "source": "cron" }                            # defaults to yesterday (Lisbon time)
```

Resolution order: `date` (if valid) → `date_offset` (if numeric) → yesterday (Lisbon).

The endpoint authorizes via the `X-Cron-Secret` header (matched against the env var `CRON_SECRET`, already set in Replit Secrets).

**Recommended cron schedule**: 07:00 Lisbon, Monday–Saturday. Skip Sunday (no calls Saturday). After a public holiday, manually trigger with `date_offset: -2` to catch the previous workday.

## Known gotchas

- **Public holidays in Portugal** (1 May, 25 Apr, 10 Jun, etc.) have very few or no calls. The system handles this gracefully (creates an empty Run with status "done"), but the daily summary will be terse.
- **Hélio Vazão (Ringover user_id 23185416)** is on the Vida team, which is out of scope. He's hard-filtered in the conversation grouper. When new agents join Vida, update the `VIDA_AGENT_IDS` constant.
- **Alfaseguros has 4 inbound numbers** (`351215832338`, `351210270858`, `351210270860`, `351210270869`). Calls to/from any of them are normal; the customer number is always the *other* end of the call.
- **Ringover's `note` field is the AI-generated summary**, not a verbatim transcript. About 39% of all calls and 72% of answered calls have one. Calls without a `note` are filtered out (no signal to analyze). Strip the trailing `Generated by AI...` suffix before feeding to the LLM.
- **`p-queue` concurrency is 4.** Lower if rate limits become an issue. Higher will likely hit OpenRouter rate limits.

## Phase 2A — Zoho Desk integration (work in progress)

This phase extends the system to merge calls with Zoho Desk tickets into **cases** — the unit that captures a full customer engagement across channels (phone, email, ticket comments). See [`openspec/changes/phase-2a-desk-cases/`](./openspec/changes/phase-2a-desk-cases/) for the full proposal, design, tasks, and delta spec.

### Planned shape

- Drizzle schemas: `tickets`, `ticket_comments`, `cases`, `case_tickets`, `case_calls`, `ticket_sync_state`
- Zoho Desk OAuth refresh-token client (Self-Client flow, US datacenter `desk.zoho.com`, Org ID `683863304`)
- `listTicketsCreatedBetween`, `listTicketComments` — fetch with pagination, `include=contacts,assignee`
- `syncTickets(from, to)` job — idempotent upsert into Postgres
- Phone normalization (Ringover digits ↔ Desk free-form), fingerprint = last 9 digits
- `buildCases({ calls, tickets, comments })` — links by phone fingerprint within ±14d proximity
- `classifyOutcome(ticket)` — rule-based mapping over `cf_*` fields (won/lost/open/unknown)
- Diagnostic CLI: `pnpm run zoho:probe-tickets -- --days=7 --limit=20`

### Setup steps for the user (one-time)

1. Visit https://api-console.zoho.com/ → Self Client tab
2. Generate code with scope: `Desk.tickets.READ Desk.contacts.READ Desk.search.READ Desk.basic.READ`
3. Exchange the auth code for a refresh token via curl POST to `https://accounts.zoho.com/oauth/v2/token`
4. Set Replit secrets: `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ORG_ID=683863304`
5. Test: `pnpm run zoho:probe-tickets`

### Why this architecture

- **Tickets as the case anchor.** Each Desk ticket = one case (most natural unit, matches Alfaseguros' actual workflow). Calls without a ticket form orphan single-call cases that can later be merged if a ticket appears.
- **±14 day proximity for call-to-ticket linking.** Generous enough to catch follow-ups, tight enough not to merge unrelated cases for the same customer.
- **Phone fingerprint = last 9 digits.** Matches Ringover's `351...` format with Desk's free-text `+351 911 ...`.
- **Outcome classification is rule-based, not AI.** Faster, cheaper, deterministic. The AI is reserved for the per-case narrative analysis.

## Testing

Vitest is the planned test runner. Tests are colocated as `*.test.ts` next to the file being tested. Initial priorities:
1. `grouping/conversations.test.ts` — phone normalization, multi-leg detection, edge cases (3+ legs, mixed agents)
2. `analysis/schema.test.ts` — schema accepts all valid LLM responses, rejects malformed ones
3. `lib/dates.test.ts` — Lisbon timezone correctness across DST
4. `cases/linker.test.ts` (Phase 2A) — phone fingerprint matching, ±14d window edges
