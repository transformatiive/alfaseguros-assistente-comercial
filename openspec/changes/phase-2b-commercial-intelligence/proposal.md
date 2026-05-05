# Proposal: Phase 2B — Commercial Intelligence Layer

## Intent

Phase 2A gives Rui *honest* daily reports that reflect what actually happened across channels. Phase 2B turns those reports into *commercial decisions* — answering Rui's original question: "I know we're closing less, but I don't know why."

The set of features here aren't independent — they all rely on Phase 2A's outcome data being live. They compose into a coherent commercial-intelligence layer over the supervisor base.

## Scope

**In scope:**
- **Lead temperature classification**: a new field per case (`quente | morno | frio | tire_kicker | já_cliente`) so the dashboard reframes from "all conversations equal" to "here are the warm leads"
- **Why-we-lost analysis across time**: weekly aggregate of lost cases by reason, drillable to specific examples; "30% of TVDE leads die at price objection" type insights
- **Follow-up SLA engine**: daily worker that surfaces "promised X by date Y, hasn't happened, customer hasn't replied" with a suggested message; one click to send via Desk reply or email
- **Closer playbook**: mine winning cases, surface what works per agent and per objection ("when clients raise the price objection on TVDE, Andreia closes 60% of them and the typical move is X")

**Out of scope:**
- Real-time supervision (deferred indefinitely)
- AI agent that closes deals (6-month vision, regulator-dependent)
- NoCRM / Vida-team integration
- Cross-broker benchmarking (we have only Alfaseguros data)
- Predicting deal close probability with ML (premature; rule-based is fine)

## Approach

Each feature is a new module that consumes the Phase 2A `Case` data:
- Lead temperature: an extra field on the case-level analysis schema, populated by the LLM during `analyzeCase`
- Why-we-lost: a new aggregate report endpoint + UI section on the daily summary
- Follow-up SLA: a separate daily worker that scans active cases against an SLA matrix, surfaces stale ones with draft replies
- Closer playbook: a derivative report run weekly over historical cases, queryable per agent / per product / per objection

Detailed design lives in `design.md` (to be written when Phase 2A demo is approved by Rui and Phase 2B is greenlit).

## Smallest viable version

Lead temperature classification only. It's the smallest change that materially shifts the dashboard's usefulness ("here are the 12 cases worth chasing today out of 80"). The other three features compose on top of that.

## Soft target

After Phase 2A demo to Rui. Greenlight comes from Rui — not assumed.
