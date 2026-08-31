# Proposal: Phase 3 — Painel do agente embebido no Zoho Desk

> Jira: TRNSF-1410 · Plan v2.0 §7 · Depends on: `migracao-railway`

## Intent

Today the Supervisor Virtual produces one daily email at 06:00 for the supervisor. The agents themselves get nothing they can act on, and the automatic task creation that was supposed to fill that gap just piles up unread.

Rui's ask is narrower and better: each agent should be able to open a panel **inside Zoho Desk**, where they already work, and see one thing — *what do I actually have to do today?* The supervisor gets the team view over the same data.

The existing supervisor application is not changed. This is an additive layer: new routes under `/agente` and `/supervisor`, a new frontend artifact, and a Zoho Desk extension that embeds it.

## Scope

**In scope:**

- **Seamless agent identification.** The Zoho JS SDK reads the already-logged-in agent and exchanges that identity for a short-lived token in the background. No login screen, no password, no agent picker — ever.
- **A full-page dashboard inside Zoho Desk.** `desk.topband` renders a widget as a full-screen view from the Desk top navigation bar — one menu item, one click, the whole screen. No side panels, and no second surface: the Zoho CRM Web Tab that earlier drafts proposed was cut on 2026-08-31 (see `tasks.md` §7B).
- **Agent panel** (`/agente`) with four blocks, per the Plan v2.0 §7 prototype:
  - Chamadas por devolver — missed inbound calls assigned to this agent, with the context of the request
  - Tickets em risco — this agent's open tickets past 24 hours
  - Follow-ups — commercial-cadence promises this agent made and has not closed
  - Alerta das 16h30 — what is still outstanding at end of day
- **Supervisor panel** (`/supervisor`) — team totals, load per agent, and a redistribution suggestion
- **Two refreshes per day** — 08:00 and 16:30 Lisbon, triggered from n8n
- **`papel` on `colaboradores`** — `agente | supervisor | nenhum`, so the same login resolves to the right panel
- A `devolucoes` table so a returned call can be marked done and stay done

**Out of scope:**

- **Agendamentos e renovações.** The Plan mentions these in the panel. They live in the CRM, and the CRM 360 migration (Plan §8.2) has not happened. The panel reserves the slot and shows an explicit "ainda não disponível" state rather than faking it.
- Turning off the 06:00 email and the automatic task creation. That is a separate, later change, made only once the panel is in real use.
- Writing anything back to Zoho Desk (no ticket updates, no comments)
- Any change to the existing supervisor SPA, its routes, its auth, or its data model beyond additive columns and tables

## Approach

Three pieces, each independently testable:

1. **A new API surface** `/api/agente/*` and `/api/supervisor/*`, mounted before `requireAuth` with its own guard. Reads from data the system already has — Ringover calls, synced Desk tickets, follow-up detections — filtered to one agent.
2. **A new frontend artifact** `artifacts/agente`, built with the same stack, served at `/agente`. Separate from `artifacts/supervisor` so that nothing in the existing app is touched.
3. **One thin embed** — a Zoho Desk `desk.topband` widget that reads the agent from the Desk SDK, mints a token, and renders the panel full screen.

## Smallest viable version

The "Chamadas por devolver" block only, for one agent, reached from the Desk topband button. It is the block with the clearest daily value (~28 missed calls a working day), it exercises the whole identification chain end to end, and it is the one Rui can validate in five minutes.

## Soft target

Fase 3 of the plan — October / November. Prerequisite: `migracao-railway` shipped.
