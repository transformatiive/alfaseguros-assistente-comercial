# Alfaseguros — Supervisor Virtual

> **New here? Read in this order:** [`CONTEXT.md`](./CONTEXT.md) → [`HANDOVER.md`](./HANDOVER.md) → [`CLAUDE.md`](./CLAUDE.md) → this file. CONTEXT explains who Alfaseguros is and what Rui wants. HANDOVER covers concrete technical findings and design rationale. CLAUDE.md covers conventions for working in the codebase. For active scope and requirements see [`openspec/`](./openspec/).

Daily AI-powered analysis of phone conversations from the Alfaseguros Não Vida (360) team. Groups inbound and outbound calls between Alfaseguros and the same customer into "conversations," then analyses each conversation end-to-end with Claude (via OpenRouter) to produce:

- A narrative of the conversation (the "story" of what the customer wanted and what happened)
- Procedural deviation flags
- Coaching feedback for the operator(s)
- Specialist insurance suggestions
- Risk and follow-up assessment

A daily executive summary is generated for the supervisor, with five structured sections:

- ✓ **O que está a funcionar bem** — observed strengths
- ⚠ **O que pode ser melhorado** — actionable improvements
- 🚨 **Riscos identificados** — leads at risk, operational red flags
- 🎯 **Recomendações para fechar mais** — concrete techniques to lift conversion
- 🤖 **Oportunidades de Automação** — repetitive patterns suitable for AI agent (voice/chat/email/self-service)

The UI also exposes a **"Por Operador"** view with per-operator coaching: strengths, blind spots, closing-rate observations, and personalised recommendations.

## Stack

pnpm workspace monorepo · Node 24 · TypeScript 5.9 strict · Express 5 · Postgres + Drizzle ORM · OpenAPI + Orval (Zod + React Query codegen) · Vite + React + TanStack Query + Tailwind + Wouter.

## Quick start (Replit)

1. **Import this repo into a Replit**.
2. **Add a Postgres database**: Replit → Tools → Database → enable Postgres. Replit provisions a managed Postgres 16 instance and sets the `DATABASE_URL` env var automatically.
3. **Set Replit Secrets**:
   - `RINGOVER_API_KEY` — find in n8n credentials or Ringover dashboard → Settings → API
   - `OPENROUTER_API_KEY` — from https://openrouter.ai/keys
   - `CRON_SECRET` — any random string (used by the n8n cron trigger; verified via `X-Cron-Secret` header)
   - `PUBLIC_APP_URL` — e.g. `https://alfaseguros-supervisor.replit.app`
   - **Phase 2A** (when wiring Zoho Desk): `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ORG_ID=683863304`
4. **Run setup once**: `pnpm install && pnpm --filter @workspace/db run push` to install dependencies and apply the Drizzle schema.
5. **Click Run**. Replit boots the API + UI.
6. Open the Replit web preview. Pick a date (date picker top-right + quick buttons "Ontem", "Há 2 dias", "Há uma semana"). Click **Analisar este dia**.

## Local dev

```bash
cp .env.example .env       # fill in keys
pnpm install
pnpm --filter @workspace/db run push           # creates / updates DB schema
pnpm --filter @workspace/api-server run dev    # API on :3000
pnpm --filter @workspace/supervisor run dev    # UI on :5173 (proxies /api)
```

Open http://localhost:5173.

## Daily cron

The intent is for n8n on Railway to hit `/api/run` once per day at ~07:00 Lisbon time, with yesterday's date. See [`CLAUDE.md`](./CLAUDE.md) for the exact webhook signature.

## Manual CLI (planned)

```bash
pnpm run analyze:cli -- --date=2026-04-30
pnpm run analyze:cli -- --date=2026-04-30 --force   # ignore cache
```

## Cost

With prompt caching and cache-by-default, a full-day run analysing ~60 conversations costs roughly **$0.50–$1.00** on Sonnet 4 via OpenRouter. Re-running the same day is free (cache hit). The per-run total is logged to `runs.totalCostUsd`.

## Project conventions

See [`CLAUDE.md`](./CLAUDE.md) — that file is the source of truth for how to extend this codebase.

## What this is NOT (yet)

- Does not write back to Zoho Desk (planned)
- Does not send email summaries (planned)
- Does not analyse the Vida team (NoCRM integration deferred)
- Procedures manual is a strawman — to be replaced with Soraia's real manual

## Phase 2A status — Zoho Desk integration (in progress)

Cross-channel "cases" (calls + tickets + email threads merged into one customer engagement unit) are scoped in [`openspec/changes/phase-2a-desk-cases/`](./openspec/changes/phase-2a-desk-cases/). Outline:

- ⏳ Drizzle schema for tickets, comments, cases
- ⏳ Zoho Desk OAuth client + ticket sync job
- ⏳ Phone normalization + case linker (call ↔ ticket via phone fingerprint, ±14d proximity)
- ⏳ Diagnostic CLI to inspect ticket schema (`pnpm run zoho:probe-tickets`)
- ⏳ Outcome classification (won/lost/open) — rule-based against `cf_*` fields, blocked on a probe of live tickets
- ⏳ Case-level AI analyzer (call + email threads in one prompt)
- ⏳ Pipeline view UI

See `CLAUDE.md` → "Phase 2A" section for the full plan.

## Status

Prototype. Not yet wired to production data flows in Alfaseguros' Zoho stack.
