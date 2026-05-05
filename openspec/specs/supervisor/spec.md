# Spec: Supervisor Virtual — Canonical (As-Built)

> **Status:** Phase 1 deployed on Replit
> **Last updated:** 2026-05-04
> **Companion docs:** `/CONTEXT.md` (business), `/HANDOVER.md` (technical), `/CLAUDE.md` (conventions)

This spec describes what the system actually does today. In-flight changes live under `openspec/changes/`. When a change is archived, its delta is merged into this file.

---

## Domain

Daily AI-powered analysis of phone conversations from the Alfaseguros Não Vida (360) team. The system fetches calls from Ringover, groups them into customer-level conversations, analyses each conversation with Claude (via OpenRouter), and produces a structured supervisor report with per-operator coaching.

## Capabilities

### Requirement: Trigger a daily analysis

The system MUST allow a daily analysis to be triggered for any past date.

#### Scenario: Manual trigger from the UI for yesterday

- GIVEN Nuno opens the dashboard at 07:30 on a Monday
- WHEN he clicks "Analisar este dia" with yesterday's date selected
- THEN the system fetches calls for that date from Ringover
- AND begins analysis with live progress visible
- AND produces a daily summary plus per-operator analyses on completion

#### Scenario: Cron trigger from n8n

- GIVEN the n8n daily cron fires at 07:00 Lisbon, Monday-Saturday
- WHEN it POSTs to `/api/run` with `{date_offset: -1, source: "cron"}` and the correct `X-Cron-Secret` header
- THEN the system starts an analysis for yesterday (Lisbon time)
- AND returns `{status: "started"}` immediately while analysis runs async

#### Scenario: Cron trigger with invalid secret

- GIVEN any caller POSTs to `/api/run` with `source: "cron"`
- WHEN the `X-Cron-Secret` header is missing or doesn't match
- THEN the system returns 401 Unauthorized
- AND no analysis runs

#### Scenario: Browse a past day with cached data

- GIVEN the system has previously analysed `2026-04-30`
- WHEN Nuno picks that date in the UI
- THEN the cached analysis loads without re-running
- AND the cost of viewing this past day is zero

### Requirement: Cache analysis results by default

The system MUST NOT re-analyse a conversation that has already been analysed unless explicitly forced.

#### Scenario: Re-running an already-analysed day

- GIVEN every conversation for date X has a successful `analysisJson`
- WHEN a run is triggered for date X without `force: true`
- THEN every conversation reports a cache hit
- AND `totalCostUsd` for the run is at most the cost of the daily summary regeneration
- AND analysis output is unchanged

#### Scenario: Forcing re-analysis after procedures change

- GIVEN Soraia has updated `src/procedures/procedures.md`
- WHEN a run is triggered with `force: true`
- THEN every conversation is re-analysed against the new procedures
- AND a new daily summary and per-operator analyses are generated

#### Scenario: Force-refresh a single conversation

- GIVEN Nuno clicks "Re-analisar esta conversa" on one card
- WHEN the request includes `force_customer_numbers: ["351911234567"]`
- THEN only that conversation is re-analysed
- AND all other conversations remain cached

### Requirement: Filter calls down to analysable conversations

The system MUST filter Ringover calls before analysis to remove noise.

#### Scenario: Unanswered calls are excluded

- GIVEN a call has `is_answered: false`
- WHEN filtering for analysis
- THEN the call is dropped

#### Scenario: Calls without an AI summary are excluded

- GIVEN a call's `note` field is empty or under 50 characters
- WHEN filtering for analysis
- THEN the call is dropped (insufficient signal)

#### Scenario: Vida-team agents are excluded

- GIVEN a call's agent has Ringover `user_id: 23185416` (Hélio Vazão, Vida)
- WHEN filtering for analysis
- THEN the call is dropped (out of scope for Não Vida supervisor)

### Requirement: Group calls into customer-level conversations

The system MUST group calls within the same day by customer phone number.

#### Scenario: Single inbound call

- GIVEN one inbound call from `351911111111` to `351215832338` at 10:00
- WHEN grouped
- THEN one conversation is produced with `leg_count: 1` and `is_multi_leg: false`

#### Scenario: Inbound followed by outbound, same customer

- GIVEN one inbound from `351911111111` at 10:00 and one outbound to `351911111111` at 14:00 (different agents)
- WHEN grouped
- THEN one conversation is produced with `leg_count: 2`, `is_multi_leg: true`
- AND `agents_involved` lists both agents

#### Scenario: Different customers on the same day

- GIVEN calls with two distinct customer numbers
- WHEN grouped
- THEN two separate conversations are produced

### Requirement: Analyse each conversation with the LLM

The system MUST produce a Zod-validated structured analysis for each conversation.

#### Scenario: A typical TVDE simulation conversation

- GIVEN a multi-leg conversation about a TVDE quote
- WHEN analysed
- THEN the result includes the fields: `categoria`, `produto`, `narrativa_conversa`, `arco_conversa`, `sentimento_cliente_evolucao`, `qualidade_global` (1-5), `continuidade`, `desvios_procedimento[]`, `pontos_positivos[]`, `feedback_supervisor`, `sugestao_especialista`, `follow_up_necessario`, `follow_up_descricao`, `risco_perda_lead`, `tags[]`
- AND the output passes `analysisSchema.safeParse`
- AND the language is European Portuguese

#### Scenario: LLM returns invalid JSON

- GIVEN the LLM response cannot be parsed as JSON or fails Zod validation
- WHEN the analyzer encounters this
- THEN the conversation row is updated with `analysisError` set
- AND the run continues with other conversations
- AND the failed conversation appears as "error" in the UI

#### Scenario: Rate-limited by OpenRouter

- GIVEN OpenRouter returns HTTP 429 or 503
- WHEN the analyzer sees this
- THEN it retries with exponential backoff up to 4 times, honouring `Retry-After` if present
- AND the UI shows a "rate limited, retrying" status for the affected conversation

### Requirement: Generate a daily summary in 5 sections

The system MUST produce a daily executive summary structured as five named sections plus an opener.

#### Scenario: Daily summary on a normal day

- GIVEN at least one conversation has been successfully analysed for date X
- WHEN the summarizer runs
- THEN the saved `DailySummary.sectionsJson` contains: `executive_summary`, `working_well` (paragraph + bullets), `to_improve` (paragraph + bullets), `risks` (paragraph + bullets), `closing_rate_recommendations` (paragraph + bullets), `automation_opportunities` (paragraph + items[])
- AND the output passes `dailySummarySchema.safeParse`

#### Scenario: Daily summary on a public holiday with no calls

- GIVEN no conversations for date X (e.g. 1 May)
- WHEN the run finishes
- THEN no `DailySummary` is generated for that date
- AND the run completes with status "done" and zero cost

### Requirement: Generate a per-operator analysis

The system MUST produce a coaching analysis for each operator who participated in conversations that day.

#### Scenario: An operator with multiple conversations

- GIVEN an operator participated in 5 conversations on date X
- WHEN per-operator analysis runs
- THEN one `AgentAnalysis` row is saved for that operator and date
- AND it contains: `paragraph_overview`, `strengths[]`, `blind_spots[]`, `closing_rate_observations`, `coaching_recommendations[]`
- AND the precomputed metrics include `conversationsTotal`, `conversationsClosed`, `conversationsAtRisk`, `avgQuality`, `deviationsTotal`

#### Scenario: An operator only appearing on multi-agent conversations

- GIVEN agent A participated in 2 conversations both alongside agent B
- WHEN per-operator analysis runs
- THEN both A and B receive their own `AgentAnalysis` rows
- AND the prompts make clear which calls were solo vs joint so coaching is fair

### Requirement: Surface live progress in the UI

The system MUST stream progress events while a run is in flight.

#### Scenario: Live progress during a run

- GIVEN Nuno triggers a run from the UI
- WHEN the run begins
- THEN the browser receives Server-Sent Events for `run:start`, `conv:start`, `conv:done`, `conv:error`, `summary:done`, `agents:done`, `run:done`
- AND each conversation card updates state in real time

#### Scenario: Closing the browser mid-run

- GIVEN a run is in progress and Nuno closes the tab
- WHEN the run completes
- THEN results are still saved to Postgres
- AND re-opening the dashboard shows the completed analysis

### Requirement: Two views — Visão Geral and Por Operador

The system MUST offer at least two views over the day's data.

#### Scenario: Toggling between views

- GIVEN cached analyses exist for the selected date
- WHEN Nuno toggles "Por Operador"
- THEN the conversation list is replaced by a list of `AgentAnalysis` cards
- AND toggling back to "Visão Geral" restores the conversation list with stats and daily summary

### Requirement: Browse arbitrary past days

The system MUST allow browsing any historical day with cached data, without re-running.

#### Scenario: Quick-button navigation

- GIVEN Nuno clicks "Há uma semana"
- WHEN the date changes
- THEN the dashboard fetches `/api/day/<that-date>` and renders cached results, or shows the empty state if no run exists for that day

#### Scenario: Date picker with no cached data

- GIVEN Nuno picks a date that has never been analysed
- WHEN the dashboard loads
- THEN the empty state shows with a single "Analisar este dia" CTA

### Requirement: European Portuguese only in user-facing output

The system MUST produce all analyses, summaries, coaching feedback, and UI labels in European Portuguese.

#### Scenario: Brazilian-Portuguese leakage

- GIVEN the LLM occasionally drifts to Brazilian-PT phrasing
- WHEN reviewers spot this
- THEN the prompt is updated and the day is force-re-analysed
- AND no UI label, button, badge, or system message is in any language other than EU-PT

### Requirement: Cost discipline

The system MUST keep a full-day analysis run under €1.50 in LLM costs at expected volumes (~80-200 conversations).

#### Scenario: Prompt caching is active

- GIVEN the system prompt is marked `cache_control: ephemeral`
- WHEN multiple conversations are analysed within 5 minutes
- THEN the second-and-subsequent conversations report `cached_tokens > 0` in their usage
- AND per-conversation cost drops by ~80% versus the first

#### Scenario: Run cost is observable

- GIVEN any run completes
- WHEN inspecting the `Run` row
- THEN `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, `totalCachedTokens` are populated and accurate
