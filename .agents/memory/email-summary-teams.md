---
name: Email summary teams endpoint
description: Per-team (360 / vida) summaries in GET /api/email/summary, cached in DB.
---

# Email Summary — Teams & Follow-ups

## Shape
`GET /api/email/summary?date=YYYY-MM-DD` returns:
- `teams.360` and `teams.vida` — LLM-generated summaries scoped to each team's conversations
- `operators[].team` — "360" | "vida" | "other"
- `operators[].followups[]` — 360-only; each item has `desk_url` when a Zoho ticket is linked via `analysis_json.ticketsRelevantes`

## Caching
Team summaries are generated lazily on first request and stored in `daily_summaries.team_summaries_json` (JSONB). Subsequent calls return in ~180ms from DB.

**Why:** LLM calls per team are expensive; caching avoids redundant cost on repeated n8n triggers.

## Team membership (360)
Andreia Almeida, Andreia Coelho, Vânia Rodrigues, Marina Fernandes, João Martins, João Catalão, Tiago Paiva, Ana Inácio. Names normalized (accents stripped, lowercased, double spaces collapsed) before comparison. Everyone else → vida.

## desk_url note
`ticketsRelevantes` in `analysis_json` contains short ticket_numbers (not IDs). The route joins `tickets.ticket_number → tickets.id` to build the Zoho Desk URL. If the LLM found no relevant tickets (empty array), `desk_url` is absent — graceful degradation.
