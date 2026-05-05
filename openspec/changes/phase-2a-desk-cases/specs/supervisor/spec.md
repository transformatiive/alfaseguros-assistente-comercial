# Delta for Supervisor — Phase 2A

## ADDED Requirements

### Requirement: Sync Zoho Desk tickets and comments

The system MUST mirror Zoho Desk tickets and their comment threads into Postgres for a configurable historical window.

#### Scenario: First-time sync for a 90-day window

- GIVEN the Zoho Desk OAuth credentials are valid
- WHEN `syncTickets(now - 90d, now)` runs
- THEN every ticket in that window is upserted with its standard fields and `cf` blob preserved
- AND every comment for those tickets is upserted with channel + author + content (sanitised HTML)
- AND a `TicketSyncState` row records the window and counts

#### Scenario: Idempotent re-sync

- GIVEN sync ran for the same window yesterday
- WHEN it runs again today
- THEN tickets that haven't changed are no-op upserts
- AND tickets that have been modified since are updated with new modified time + new comments

#### Scenario: OAuth token refresh

- GIVEN the cached access token is expired
- WHEN any Desk API call is made
- THEN a fresh access token is minted via the refresh token
- AND the cache is updated to expire 60s before the new token's actual expiry

### Requirement: Classify ticket outcomes from custom fields

The system MUST classify each ticket as `won | lost | open | unknown` based on rules over its custom fields.

#### Scenario: Closed ticket with policy issued

- GIVEN a closed ticket has `cf_apolice_emitida = "Sim"` (or equivalent confirmed-won field)
- WHEN classified
- THEN status is `won` and reason cites the field+value

#### Scenario: Closed ticket with loss reason

- GIVEN a closed ticket has `cf_motivo_perda` populated (e.g. "Preço")
- WHEN classified
- THEN status is `lost` and reason includes the loss motive

#### Scenario: Closed ticket with no clear outcome signal

- GIVEN a closed ticket where no rule matches
- WHEN classified
- THEN status is `unknown` and reason explains "closed but no outcome rule matched"
- AND the run does not crash; the case continues with `unknown` outcome

#### Scenario: Open ticket

- GIVEN a ticket whose status is not `Closed`
- WHEN classified
- THEN status is `open`, regardless of cf_* values

### Requirement: Link calls and tickets into cases

The system MUST join Ringover calls and Zoho Desk tickets into `Case` rows representing cross-channel customer engagements.

#### Scenario: Call within ±14 days of a ticket from the same customer

- GIVEN a call from `351911234567` at 2026-04-30T10:00 and a ticket with contact phone `+351 911 234 567` created 2026-04-25T15:00
- WHEN cases are built
- THEN both belong to the same case (anchored on the ticket)
- AND the case timeline includes the call and the ticket creation event in chronological order

#### Scenario: Call with no nearby ticket

- GIVEN a call from a phone with no ticket in ±14 days
- WHEN cases are built
- THEN an orphan case is created with `case_p_<fingerprint>_<date>` ID
- AND `outcome_status` is `unknown` with reason "no ticket linked"

#### Scenario: Call matches multiple tickets — closest activity wins

- GIVEN a call's phone fingerprint matches two tickets within ±14 days
- WHEN building cases
- THEN the call joins the case whose nearest activity time is closest to the call time
- AND it does not appear in both cases

#### Scenario: Different customers, never merge

- GIVEN two tickets with different phone fingerprints, even on the same day
- WHEN building cases
- THEN they remain separate cases

### Requirement: Analyse cases at the case level

The system MUST run an LLM analysis on each case using the multi-channel timeline as input.

#### Scenario: Case with one inbound call followed by an email reply

- GIVEN a case with: inbound call (10:00), ticket created (10:05), agent emails simulation (11:00), customer replies via email (15:00)
- WHEN analysed
- THEN the produced `narrativa_conversa` references both the call content AND the email exchange
- AND `continuidade` reflects the actual continuity (e.g. "boa" if the email response addressed the customer's request)
- AND if no further action happened, `follow_up_necessario` is true with a sensible `follow_up_descricao`

#### Scenario: Case where multi-channel changes the picture vs. call-only

- GIVEN a case where the call alone looks like "no follow-up made" but the email thread shows the follow-up did happen
- WHEN analysed at case-level
- THEN the analysis reflects the email follow-up, NOT the false "missing follow-up" of the call-only view
- AND `feedback_supervisor` is fair to the operator

#### Scenario: Very long email thread (token budget)

- GIVEN a case whose total prompt would exceed 30k tokens
- WHEN analysed
- THEN older comments are summarised individually first
- AND the case-level analysis uses the summaries plus the most recent N raw comments

### Requirement: Pipeline view in the UI

The system MUST offer a Pipeline view as a third option in the view toggle.

#### Scenario: Pipeline view default

- GIVEN cached cases exist for the selected date's window (±14 days)
- WHEN Nuno toggles to "Pipeline"
- THEN cases are listed sorted by `lastActivityAt` descending
- AND each card shows customer, agents, product, outcome (colour-coded), and days-since-last-touch

#### Scenario: Filter by outcome

- GIVEN the Pipeline view is open
- WHEN Nuno filters to `outcome: lost`
- THEN only lost cases are visible
- AND the count updates accordingly

#### Scenario: Stale-only filter

- GIVEN cases with various last-touch dates
- WHEN Nuno enables "stale only" (>7 days)
- THEN only cases with no activity in 7+ days are visible
- AND each card prominently shows the days-since-touch

### Requirement: Case-level live progress

The system MUST stream case analysis progress over SSE alongside conversation events.

#### Scenario: Live updates during a run with cases

- GIVEN a run that produces both conversation analyses and case analyses
- WHEN a client subscribes to `/api/progress/:date`
- THEN it receives `case:start`, `case:done`, `case:error`, `cases:done` events
- AND existing `conv:*`, `summary:done`, `agents:done` events still fire as before

## MODIFIED Requirements

### Requirement: Trigger a daily analysis

The system MUST allow a daily analysis to be triggered for any past date, AND when Zoho Desk credentials are configured, the analysis MUST also sync tickets and produce case-level analyses for the date's ±14-day window.

(Previously: the daily analysis covered only Ringover calls.)

#### Scenario: Manual trigger with Desk credentials configured

- GIVEN Zoho Desk credentials are present in env
- WHEN Nuno triggers a manual run
- THEN tickets in the ±14-day window are synced, cases are built, and case-level analyses run
- AND both Visão Geral and Pipeline views are populated

#### Scenario: Manual trigger without Desk credentials

- GIVEN Zoho Desk env vars are missing
- WHEN Nuno triggers a manual run
- THEN the system runs Phase 1 only (call analysis, daily summary, per-agent)
- AND the Pipeline view shows the empty state with "Desk credentials not configured" guidance

### Requirement: Cache analysis results by default

The system MUST NOT re-analyse a conversation OR a case that has already been analysed unless explicitly forced.

(Previously: applied to conversations only.)

#### Scenario: Re-running with cached cases

- GIVEN cases for date X all have `analysisJson`
- WHEN a run is triggered without `force: true`
- THEN every case reports a cache hit
- AND case-level cost for the run is zero

## REMOVED Requirements

(None in this change.)
