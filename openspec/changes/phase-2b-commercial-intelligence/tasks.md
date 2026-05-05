# Tasks: Phase 2B — Commercial Intelligence Layer

> **Status: not started.** Will be expanded when Phase 2A is shipped and Phase 2B is greenlit.

## 0. Greenlight gate

- [ ] 0.1 Phase 2A demo to Rui complete
- [ ] 0.2 Rui confirms commercial intelligence is the right next direction (vs. e.g. Vida integration, write-back to Desk, real-time)
- [ ] 0.3 Detailed design.md filled in with concrete decisions

## 1. Lead temperature

- [ ] 1.1 Add `temperatura_lead` field to `analysisSchema` (Zod)
- [ ] 1.2 Update LLM prompt to instruct classification
- [ ] 1.3 Add badge to case cards in UI
- [ ] 1.4 Add filter to Pipeline view: temperature
- [ ] 1.5 Add stat card to daily summary stats strip: "Leads quentes hoje"

## 2. Why-we-lost analysis

- [ ] 2.1 Define schema for aggregate report (reasons, counts, examples)
- [ ] 2.2 Implement aggregator that runs weekly over closed-lost cases
- [ ] 2.3 Add UI widget on daily summary showing top 5 lost reasons this week + trend vs. last week
- [ ] 2.4 Drill-in: click a reason → list of cases with that reason

## 3. Follow-up SLA engine

- [ ] 3.1 Define SLA matrix (product → days)
- [ ] 3.2 Implement daily worker that finds stale cases (promise made, no activity since, past SLA)
- [ ] 3.3 LLM-draft a follow-up message per stale case
- [ ] 3.4 UI: dedicated panel or top-of-dashboard section "Follow-ups due today"
- [ ] 3.5 One-click send via Desk reply (separate sub-task; depends on Desk write-back design)

## 4. Closer playbook

- [ ] 4.1 Implement mining job: extract agent + objection + outcome patterns from closed cases
- [ ] 4.2 Per-agent: surface in `AgentAnalysis` as "what worked for you"
- [ ] 4.3 Global: "what works for the team" reference page
- [ ] 4.4 Integrate with daily coaching feedback ("on this case agent X said Y; the team's most successful response to this objection is Z")
