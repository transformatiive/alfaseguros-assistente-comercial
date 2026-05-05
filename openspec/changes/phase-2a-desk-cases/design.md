# Design: Phase 2A — Zoho Desk Integration & Cross-Channel Cases

## Architecture overview

Three new components plus a new analyzer:

1. **Zoho Desk client** (`src/zoho-desk/`) — OAuth refresh-token flow against `accounts.zoho.com`, REST against `desk.zoho.com`. Already implemented.
2. **Ticket sync job** (`src/jobs/sync-tickets.ts`) — idempotent upsert of tickets + comments into Postgres. Already implemented.
3. **Case linker** (`src/cases/linker.ts`) — pure function that joins calls + tickets into `Case` rows. Already implemented and unit-tested.
4. **Outcome classifier** (`src/analysis/outcome.ts`) — rule-based mapping over `cf_*` fields. **Currently a stub.** Needs real ticket data via probe CLI to wire up.
5. **Case-level analyzer** (`src/analysis/case-analyzer.ts`) — **not yet built.** Reuses the existing analysis Zod schema; new user-message builder presents the multi-channel timeline to the LLM.
6. **Pipeline view UI** (`src/ui/components/PipelineView.tsx`) — **not yet built.** Third toggle option after "Visão Geral" and "Por Operador".

## Decisions

### Decision: Cases anchored on tickets, not phone+date windows

**Choice:** Each Desk ticket starts a case. Calls within ±14 days that share a phone fingerprint join that case. Calls without any matching ticket form orphan cases.

**Why:** This matches Alfaseguros' actual workflow — tickets are how the Não Vida team thinks about pipeline. Anchoring on tickets gives us natural case boundaries: a sinistro in February and a renewal simulation in April for the same customer become two different cases, not one merged blob.

**Alternatives considered:**
- Anchoring on phone+date windows (e.g. "any activity within 7 days = same case") — rejected because over-merges unrelated engagements
- Anchoring on contact ID alone — rejected because a single contact may have unrelated cases over months
- LLM-based case grouping — rejected as expensive, non-deterministic, and harder to debug

### Decision: ±14-day proximity window

**Choice:** A call links to a ticket case only if the call timestamp falls within ±14 days of any ticket activity (creation, modification, closure, comment).

**Why:** Tighter (3-7 days) misses follow-up calls that legitimately happen a week+ later, common in insurance sales. Looser (30+) starts merging unrelated cases for repeat customers. 14 days is the sweet spot for the typical TVDE simulation→close flow.

**Alternatives considered:** 7 days (too tight), 30 days (over-merge), dynamic window based on product (over-engineered for v1).

### Decision: Phone fingerprint = last 9 digits of normalised number

**Choice:** Normalise to digits-only with `351` prefix for 9-digit Portuguese numbers, then take the last 9 digits as the fingerprint.

**Why:** Ringover stores phones as `351911234567`, Desk stores them as humans typed them (`+351 911 234 567`, `911234567`, `00351 911234567`, etc.). Last 9 digits is the most reliable common substring across all formats.

**Alternatives considered:** Full E.164 normalisation (more complex, doesn't add value for PT-only); exact string match (won't work given format variance).

### Decision: Rule-based outcome classification, not AI

**Choice:** `classifyOutcome(ticket)` reads `cf_*` fields and returns `won | lost | open | unknown` with a human-readable reason.

**Why:**
- **Determinism**: same ticket → same outcome every time
- **Cost**: classifying tens of thousands of tickets with an LLM is expensive and unnecessary
- **Auditability**: when Rui asks "why did you say this deal was lost?", we can answer "because cf_motivo_perda = 'Preço'"
- **Speed**: bulk classification on a 90-day window in milliseconds vs. minutes

**Alternatives considered:** LLM-based classification (rejected for above reasons); ML classifier (no training data, premature); ignoring outcome entirely and only doing narrative (rejected because outcome is the whole point of Phase 2A).

### Decision: Case-level analyzer reuses the existing Zod schema

**Choice:** `analyzeCase()` produces output validated against the same `analysisSchema` used for call-only conversations.

**Why:** UI components, filters, badges, and per-operator aggregation all assume that schema. Changing it would cascade. The case-level richness comes from the *input* (multi-channel timeline) and shows up in fields like `narrativa_conversa` and `continuidade` becoming materially better, not from new fields.

**Alternatives considered:** A separate `caseAnalysisSchema` with extra fields (`channel_continuity`, `email_quality`, etc.) — deferred to Phase 2B if Rui asks for them.

## Data flow

```
Daily 07:00 cron (n8n on Railway)
        │
        ▼
POST /api/run { date_offset: -1, source: "cron" }
        │
        ▼
analyzeDay(date)
  1. fetchCallsForDate(date)            ──▶ Ringover API
  2. filterAnalyzable() + groupConvos
  3. syncTickets(date - 90d, date)      ──▶ Zoho Desk API
     └─ classifyOutcome(t) per ticket
  4. buildCases({ calls, tickets, comments })
     └─ phone fingerprint + ±14d
  5. analyzeCase(case) per case          ──▶ OpenRouter
     └─ cache-by-default; force=true overrides
  6. generateDailySummary()              ──▶ OpenRouter
  7. analyzeAgent() per active operator  ──▶ OpenRouter
  8. SSE events stream live to UI
        │
        ▼
Postgres (Replit)
        │
        ▼
Express API ──▶ React UI
              (Visão Geral / Por Operador / Pipeline)
```

## Files to create or modify

| Path | Status | Purpose |
|---|---|---|
| `prisma/schema.prisma` | MODIFIED | Already updated with Ticket, TicketComment, Case, CaseTicket, CaseCall, TicketSyncState models |
| `src/zoho-desk/auth.ts` | DONE | OAuth refresh-token cache |
| `src/zoho-desk/client.ts` | DONE | REST client with pagination |
| `src/zoho-desk/types.ts` | DONE | TypeScript types for Desk responses |
| `src/jobs/sync-tickets.ts` | DONE | Idempotent ticket + comment upsert |
| `src/cases/linker.ts` | DONE | Case linking algorithm |
| `src/cases/linker.test.ts` | DONE | Unit tests for linker (5 tests passing) |
| `src/lib/phone.ts` | DONE | Phone normalisation + fingerprint |
| `src/lib/phone.test.ts` | DONE | Unit tests for phone (10 tests passing) |
| `src/analysis/outcome.ts` | STUB | **Replace heuristic rules with real cf_* mapping after probing.** |
| `src/probe-tickets.ts` | DONE | Diagnostic CLI for cf_* schema |
| `src/cli-sync-tickets.ts` | DONE | Manual sync CLI |
| `src/analysis/case-analyzer.ts` | NEW | Case-level analysis: build user-message from `LinkedCase`, call OpenRouter, validate. |
| `src/api/routes.ts` | MODIFIED | Add `GET /api/day/:date/pipeline` returning cases for a window |
| `src/storage/repo.ts` | MODIFIED | Add `saveCase`, `findCachedCase`, `getCasesForWindow` |
| `src/jobs/analyze-day.ts` | MODIFIED | After conversation analysis, also build cases and run case-level analyzer; persist; emit SSE events |
| `src/ui/components/PipelineView.tsx` | NEW | Third toggle option; cases as cards with outcome/product/agent/days-since-touch filters |
| `src/ui/App.tsx` | MODIFIED | Add "Pipeline" to view toggle |
| `src/ui/types.ts` | MODIFIED | Add `CaseDTO`, `PipelineDayDTO` types |
| `src/procedures/procedures.md` | UNCHANGED | Strawman procedures stay the same; case-level prompt references them too |
