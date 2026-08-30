# Proposal: Migração Replit → Railway

## Intent

The Supervisor Virtual runs on Replit. Everything else in the Alfaseguros stack (n8n, all four Ringover↔Desk workflows) already runs on Railway. Replit usage cost is the trigger; platform consolidation is the benefit.

This change is a **lift-and-shift with no behaviour change**. It ships before `phase-3-painel-agente` so that the new agent panel is built on the target platform, not on the one we are leaving.

## Scope

**In scope:**
- One Railway service running the Express API **and** serving the built SPA(s) from the same origin
- Railway Postgres, with the Replit database dumped and restored
- Environment variable migration (all `env()` keys in `artifacts/api-server/src/lib/env.ts`, plus `AGENT_EMAIL_MAP` currently living in `.replit` `[userenv.shared]`)
- Repointing the n8n cron (`4rx93UXKxdDdmPpY`) and every n8n HTTP node that calls this app
- Removing the hard dependency on Replit-only Vite plugins and on Replit's multi-port router
- A cutover plan with a rollback path

**Out of scope:**
- Any change to analysis logic, prompts, schema semantics, or API contracts
- Any new feature (the agent panel is a separate change)
- Custom domain (Railway-generated domain is enough for cutover; custom domain optional afterwards)

## Approach

Replit serves the API and the UI as two separate "artifacts" on two ports, stitched together by Replit's application router. Railway has no path-based router, so this is the one structural thing that must change: the Express server takes over static file serving and SPA fallback, and the whole app becomes a single service on a single origin.

Everything else is configuration.

## Smallest viable version

One Railway service + one Railway Postgres + the generated domain, with the Replit deployment left running but with its cron disabled for one week as a rollback path.

## Soft target

Before any work starts on `phase-3-painel-agente`.
