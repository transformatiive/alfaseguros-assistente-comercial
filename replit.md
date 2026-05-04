# Alfaseguros Supervisor Virtual

## Overview

Daily AI-powered analysis of phone conversations from the Alfaseguros Não Vida (360) insurance sales team. Groups calls into conversations, analyzes them with an LLM (Claude via OpenRouter), and generates coaching summaries for supervisors and operators.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, TanStack Query, Tailwind CSS, Wouter

## Architecture

```
Ringover API → fetch calls → group into conversations
                                    ↓
                          upsert to Postgres
                                    ↓
                    analyze with Claude (OpenRouter)
                                    ↓
                          save analysis + daily summary
                                    ↓
                    Express API → React UI (SSE for live progress)
```

## Artifacts

- `artifacts/api-server` — Express 5 REST API (serves `/api/*`)
- `artifacts/supervisor` — React + Vite frontend (serves `/`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Frontend Pages

- `/` — Dashboard: date navigation, executive summary (5 sections), run status, "Analisar este dia" button
- `/conversas` — Conversations list for selected date
- `/conversas/:id` — Single conversation detail with full AI analysis
- `/operadores` — Per-operator coaching summaries

## Database Schema

- `runs` — Analysis runs (date, status, progress, cost)
- `conversations` — Grouped phone conversations with AI analysis JSON
- `daily_summaries` — Daily executive summaries (5 structured sections)
- `operator_summaries` — Per-operator coaching (strengths, blind spots, recommendations)

## API Endpoints

- `POST /api/run` — Trigger analysis for a date
- `GET /api/run/:date` — Get run status
- `GET /api/summary/:date` — Get daily executive summary
- `GET /api/conversations/:date` — List conversations
- `GET /api/conversations/:date/:id` — Get conversation detail
- `GET /api/operators/:date` — Get per-operator summaries

## Required Secrets

- `RINGOVER_API_KEY` — Ringover dashboard → Settings → API
- `OPENROUTER_API_KEY` — https://openrouter.ai/keys
- `DATABASE_URL` — auto-set by Replit Postgres

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
