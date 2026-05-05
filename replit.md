# Alfaseguros Supervisor Virtual

## Overview

Daily AI-powered analysis of phone conversations from the Alfaseguros Não Vida (360) insurance sales team. Groups calls into conversations, analyzes them with Claude (via OpenRouter), and generates coaching summaries for supervisors and operators. Zoho Desk cases are linked to conversations for outcome tracking.

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
              Zoho Desk API → link cases to conversations
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

## Libraries (`lib/`)

| Package | Purpose |
|---|---|
| `@workspace/db` | Drizzle ORM schema + migration helpers |
| `@workspace/api-spec` | OpenAPI spec + Orval codegen script |
| `@workspace/api-zod` | Generated Zod request/response schemas |
| `@workspace/api-client-react` | Generated TanStack Query React hooks |
| `@workspace/ringover` | Ringover API client + call filter + grouper |
| `@workspace/openrouter` | OpenRouter API client with retry + cost tracking |
| `@workspace/zoho-desk` | Zoho Desk OAuth client + REST client |
| `@workspace/phone` | Phone number normalisation utilities |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — build composite libs only
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Frontend Pages

- `/` — Dashboard: date navigation, executive summary (5 sections), run status, "Analisar este dia" trigger button, SSE live progress
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
- `GET /api/run/:date` — Get run status + SSE progress at `/api/progress`
- `GET /api/summary/:date` — Get daily executive summary
- `GET /api/conversations/:date` — List conversations
- `GET /api/conversations/:date/:id` — Get conversation detail
- `GET /api/operators/:date` — Get per-operator summaries

## Required Secrets

- `RINGOVER_API_KEY` — Ringover dashboard → Settings → API
- `OPENROUTER_API_KEY` — https://openrouter.ai/keys
- `ZOHO_DESK_CLIENT_ID` — Zoho API Console
- `ZOHO_DESK_CLIENT_SECRET` — Zoho API Console
- `ZOHO_DESK_REFRESH_TOKEN` — generated via OAuth authorization code exchange
- `ZOHO_DESK_ORG_ID` — Zoho Desk organisation ID
- `DATABASE_URL` — auto-set by Replit Postgres

## Zoho Notes

- Zoho account is on the **`.com`** region — API calls go to `https://desk.zoho.com`
- Accounts OAuth endpoint: `https://accounts.zoho.com/oauth/v2/token`
- Refresh tokens do not expire unless revoked

## Codegen Notes

`lib/api-spec/package.json` codegen script runs Orval then patches `lib/api-zod/src/index.ts`
to only export `./generated/api` (Orval regenerates the index with stale exports otherwise).
