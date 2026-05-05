# Delta for Supervisor — Phase 2B

> **Status: draft.** Behaviours to be hardened when Phase 2A is shipped and Phase 2B is greenlit.

## ADDED Requirements

### Requirement: Lead temperature classification

The system SHOULD classify each case's lead temperature.

#### Scenario: A clearly warm lead

- GIVEN a case where the customer asked specific qualifying questions, accepted the price range, requested next steps
- WHEN analysed
- THEN `temperatura_lead = "quente"`

#### Scenario: A tire-kicker

- GIVEN a case where the customer is comparing 4 brokers, no urgency, vague answers
- WHEN analysed
- THEN `temperatura_lead = "tire_kicker"`

#### Scenario: A non-lead inquiry

- GIVEN a case from an existing client about a recibo or sinistro
- WHEN analysed
- THEN `temperatura_lead = "já_cliente"`

### Requirement: Why-we-lost weekly aggregate

The system SHOULD produce a weekly aggregate of lost cases grouped by reason.

#### Scenario: Lost-reason summary

- GIVEN ≥10 lost cases in the past 7 days
- WHEN the weekly aggregator runs
- THEN the dashboard surfaces the top 5 reasons with counts and example cases
- AND each reason links to the contributing cases

### Requirement: Follow-up SLA engine

The system SHOULD surface cases where a promised follow-up has not happened past the SLA.

#### Scenario: Stale follow-up detected

- GIVEN a case where `follow_up_necessario = true` was set 5 days ago, the SLA for that product is 3 days, and no subsequent activity has occurred
- WHEN the SLA worker runs
- THEN the case appears in "Follow-ups due today"
- AND a draft reply message is generated

### Requirement: Closer playbook

The system SHOULD extract patterns of successful closing techniques per agent.

#### Scenario: Per-agent playbook in coaching

- GIVEN agent A has closed 12 TVDE deals over the past 60 days
- WHEN per-agent analysis runs
- THEN their `AgentAnalysis` includes a "what works for you" section referencing their winning patterns

## MODIFIED Requirements

(To be filled in during Phase 2B design.)

## REMOVED Requirements

(None expected.)
