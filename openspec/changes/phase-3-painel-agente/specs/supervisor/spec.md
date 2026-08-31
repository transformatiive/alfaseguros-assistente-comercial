# Delta for Supervisor — Phase 3: Painel do agente no Zoho Desk

## ADDED Requirements

### Requirement: Identify the agent from their Zoho session

The system MUST determine which agent is viewing the panel from the logged-in Zoho session — Desk or CRM — without asking the agent for a separate password.

#### Scenario: Known, active agent opens the panel

- GIVEN Andreia is logged into Zoho Desk and her `colaboradores` row has `zid` set and `ativo = true`
- WHEN the Desk widget reads her identity and POSTs it to `/api/agente/sessao` with the correct widget token
- THEN the system returns a token valid for 15 minutes carrying her colaborador id, `papel` and `equipa`
- AND the panel loads showing only her items

#### Scenario: Agent not yet registered

- GIVEN a Desk agent whose email and `zid` match no row in `colaboradores`
- WHEN the widget requests a token
- THEN the system returns 403
- AND the widget shows a Portuguese message naming the agent's Desk email
- AND the attempt is logged with the requested identity

#### Scenario: Deactivated agent

- GIVEN a `colaboradores` row with `ativo = false`
- WHEN a token is requested for that agent
- THEN the system returns 403 and issues no token

#### Scenario: Request from the wrong portal

- GIVEN a token request whose `portalId` does not match `ZOHO_DESK_ORG_ID`
- WHEN it reaches `/api/agente/sessao`
- THEN the system returns 403 regardless of whether the widget token is valid

#### Scenario: Expired token

- GIVEN a token minted more than 15 minutes ago
- WHEN it is presented to any `/api/agente/*` endpoint
- THEN the system returns 401
- AND the widget silently mints a new token and reloads the panel

### Requirement: Reach the panel without ever authenticating

The agent MUST reach their panel without a login screen, a password, or an agent picker.

#### Scenario: One click from Zoho Desk

- GIVEN an agent is logged into Zoho Desk
- WHEN they click the panel button in the top band
- THEN the dashboard opens as a full page already showing their data
- AND at no point is a credential requested
- AND no other Zoho application is involved

#### Scenario: Returning within the working day

- GIVEN the agent opened the dashboard as a top-level page earlier today
- WHEN they reopen the same URL within 8 hours
- THEN their panel loads directly from the first-party session
- AND no token is required in the URL

#### Scenario: Framed context never uses a cookie

- GIVEN the dashboard is running inside any iframe
- WHEN it loads
- THEN it neither sets nor reads the first-party session cookie
- AND it relies only on the in-memory bearer token

#### Scenario: Cold open is not a dead end

- GIVEN the dashboard URL is opened with no token and no session
- WHEN the page renders
- THEN it offers a single "Entrar com o Zoho" action
- AND it MUST NOT render a username and password form

### Requirement: The panel is a full page, not a side panel

The dashboard MUST be presented as a full page.

#### Scenario: Zoho Desk hosts it full screen

- GIVEN `desk.topband` renders a widget as a full-screen view from the top navigation bar
- WHEN the Desk embed is built
- THEN the dashboard occupies the full Desk screen
- AND it is NOT rendered inside a Desk right panel, left tab, or record sub-tab

### Requirement: Show each agent only their own work

The system MUST scope every panel response to the colaborador identified by the presented token.

#### Scenario: Two agents, two panels

- GIVEN Andreia and João are both viewing the panel at the same time
- WHEN each panel loads
- THEN Andreia sees only calls, tickets and follow-ups attributed to her
- AND João sees only his

#### Scenario: Cross-agent write is refused

- GIVEN Andreia holds a valid token
- WHEN she attempts to resolve a devolução belonging to João
- THEN the system returns 403 and the record is unchanged

### Requirement: Present the agent's outstanding work in four blocks

The agent panel MUST answer one question — what must I do today — through four blocks: calls to return, tickets past 24 hours, open follow-ups, and the end-of-day alert.

#### Scenario: Calls to return

- GIVEN the agent had inbound calls today that went unanswered
- WHEN the panel loads
- THEN each unreturned call is listed oldest first with the customer number, the time, and any context captured for it
- AND calls already returned do not appear

#### Scenario: A call returned without anyone clicking anything

- GIVEN a missed inbound call from a number at 10:12
- WHEN an outbound call to the same normalised number is made at 11:40 the same day
- THEN the devolução is marked resolved with origin `auto`
- AND it disappears from the panel on the next refresh

#### Scenario: Tickets past 24 hours

- GIVEN the agent is the assignee on an open ticket created more than 24 hours ago
- WHEN the panel loads
- THEN the ticket is listed with its age in hours and a link that opens it in Desk

#### Scenario: End-of-day alert

- GIVEN the 16:30 refresh has run
- WHEN the agent opens the panel after 16:30
- THEN the panel shows what is still outstanding across the other blocks

#### Scenario: Scheduling data is not yet available

- GIVEN agendamentos and renovações live in the CRM and the CRM migration has not happened
- WHEN the panel loads
- THEN that block renders an explicit "not available yet" state
- AND it MUST NOT render as an empty list, which would read as "nothing scheduled"

### Requirement: Give the supervisor the team view

The system MUST provide a team-level view to colaboradores whose `papel` is `supervisor`.

#### Scenario: Supervisor opens the team view

- GIVEN Rui's colaborador row has `papel = supervisor`
- WHEN he opens the team view
- THEN he sees team totals per block and the load per agent
- AND a redistribution suggestion with its reasoning in plain Portuguese

#### Scenario: Agent tries to open the team view

- GIVEN a colaborador with `papel = agente`
- WHEN their token is presented to `/api/supervisor/painel`
- THEN the system returns 403

#### Scenario: Redistribution suggestion is rule-based

- GIVEN the per-agent loads for a day
- WHEN the suggestion is computed
- THEN it is derived by rule from the load distribution, not by an LLM call
- AND the reasoning names the agents and the counts it is based on

### Requirement: Refresh the panel twice a day at no LLM cost

The system MUST recompute panel state at 08:00 and 16:30 Lisbon time without invoking the language model.

#### Scenario: Scheduled refresh

- GIVEN n8n POSTs to `/api/painel/refresh` at 16:30 with the correct `X-Cron-Secret`
- WHEN the refresh runs
- THEN today's missed calls are recomputed and recent tickets are re-synced
- AND no OpenRouter request is made
- AND no `runs.totalCostUsd` value changes

#### Scenario: Refresh without the cron secret

- GIVEN a POST to `/api/painel/refresh` with a missing or wrong `X-Cron-Secret`
- WHEN it is received
- THEN the system returns 401 and nothing is recomputed

#### Scenario: Refresh is idempotent

- GIVEN the refresh already ran once today
- WHEN it runs again
- THEN resolved devoluções stay resolved
- AND no duplicate rows are created

### Requirement: Leave the existing supervisor application unchanged

This change MUST be additive. The existing application's routes, authentication, response shapes and UI MUST continue to behave exactly as before.

#### Scenario: Existing login still works

- GIVEN a user of the existing supervisor application
- WHEN they log in with username, password and 2FA
- THEN the session behaves exactly as before the change

#### Scenario: n8n integrations unaffected

- GIVEN the follow-up query has been extracted into a shared function
- WHEN n8n calls `GET /api/followups/pending` with its Bearer token
- THEN the response is identical to the pre-change response for the same data

#### Scenario: The daily email keeps running during rollout

- GIVEN the panel is live but not yet validated by Rui
- WHEN the 06:00 cron fires
- THEN the existing daily email is still produced
- AND it is disabled only by a separate, later change
