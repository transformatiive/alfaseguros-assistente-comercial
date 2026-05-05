# Design: Phase 2B — Commercial Intelligence Layer

> **Status: TBD.** Detailed design to be written when Phase 2A is shipped and Rui has approved continuation.

## Architecture overview

Four loosely-coupled modules, each consuming Phase 2A's `Case` data:

1. **Lead temperature** — an extra field on `analysisSchema`, populated by the LLM during `analyzeCase`. Surfaced in UI as a badge on each case.
2. **Why-we-lost analyzer** — a weekly aggregate over `Case.outcome_status = 'lost'` cases, grouped by reason. Generated lazily on demand or weekly via cron.
3. **Follow-up SLA engine** — independent daily worker. Reads cases where `follow_up_necessario = true` and the follow-up hasn't observably happened (no further activity since the promise). Drafts a reply.
4. **Closer playbook** — historical mining over closed-won cases. Extracts agent-specific patterns. Surfaces in per-agent coaching and as a global "what works" reference.

## Decisions

To be filled in during design phase. Likely items:

- LLM-based vs rule-based lead temperature classification
- SLA matrix definition (per product? per category?)
- How to detect "follow-up didn't happen" without false positives
- Whether the closer playbook is a static weekly report or queryable on demand

## Files to create or modify

To be filled in during design phase. High-level expected scope:

- New: `src/analysis/lead-temperature.ts`
- New: `src/analysis/why-we-lost.ts`
- New: `src/jobs/follow-up-sla.ts`
- New: `src/analysis/closer-playbook.ts`
- New: UI components for each
- Modified: `src/analysis/schema.ts` (add `temperatura_lead`)
- Modified: `src/api/routes.ts` (new endpoints)
- Modified: `src/ui/components/SummarySections.tsx` (why-we-lost widget)
