# Proposal: Phase 2A — Zoho Desk Integration & Cross-Channel Cases

## Intent

Phase 1 (call-only daily analysis) ships honest reports about phone conversations, but it lies by omission: when a customer engagement spans calls + email + ticket comments, we mark "follow-up missing" for things that actually happened by email, and we mark deals "open" that have closed in Zoho Desk. Rui can't trust the numbers.

Phase 2A fixes this by ingesting Zoho Desk tickets and their comment threads, linking them to Ringover calls into **cases** (the cross-channel customer-engagement unit), and reading the actual outcome from custom fields the team already maintains.

This is the prerequisite for any commercial-intelligence feature in Phase 2B (lead temperature, why-we-lost, follow-up SLA, closer playbook). Without ground-truth outcome data, those features are guesswork.

## Scope

**In scope:**
- Pull Zoho Desk tickets + their comment threads for a configurable historical window (default 90 days)
- Persist tickets, comments, and a normalised customer phone fingerprint
- Link calls and tickets into `Case` rows by phone fingerprint with a ±14-day proximity window
- Classify each ticket's outcome (won / lost / open / unknown) using rule-based mapping over Alfaseguros' custom fields
- Run a case-level LLM analysis that sees calls + ticket events + email threads in chronological order
- Add a third UI view: "Pipeline" with cases filterable by outcome, product, agent, days-since-last-touch
- Provide a `zoho:probe-tickets` diagnostic CLI to inspect ticket schema and surface custom-field names + sample values

**Out of scope:**
- Real-time push from Zoho Desk (we sync on demand and on the daily cron)
- Editing tickets from the supervisor app (read-only against Zoho)
- Vida-team tickets (out of scope for the project as a whole)
- Lead temperature classification (Phase 2B)
- Why-we-lost aggregate analysis across time (Phase 2B)
- Follow-up SLA engine (Phase 2B)
- Closer playbook (Phase 2B)

## Approach

Tickets and comments are mirrored into Postgres via a Zoho Desk OAuth refresh-token client. A linker joins them with calls into `Case` rows using a phone fingerprint (last 9 digits) plus a ±14-day proximity window. A rule-based outcome classifier reads the cf_* fields the Não Vida team already maintains. A new case-level analyzer reuses the existing analysis Zod schema but consumes the multi-channel timeline as input.

Detailed design lives in `design.md`.

## Smallest viable version

A single-day demo for Rui where he sees:
- Yesterday's pipeline view
- Cases with outcome (won/lost/open/unknown) populated
- At least one case where the multi-channel narrative makes the analysis materially better than the call-only version

If we get that, we've proven the integration is worth the complexity and Phase 2B can be planned in concrete terms.

## Soft target

Phase 2A demo to Rui — date TBD with Nuno, but soft-targeted to the next supervisor sync.
