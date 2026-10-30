# QA HANDOFF — Leads por canal e responsável

### Summary
The `/leads` dashboard gets 3 new channels (Alice, Telefone, Email), a lead type per lead, the current owner per lead and open/closed state. New sections: Tipo de lead por canal, Quem está a tratar as leads (load marker), Canal × pessoa. New filters: canal, tipo, pessoa. New `GET /leads/resumo.json` (also `/api/leads/resumo.json`) with count-only data for the daily leads email. Replit links replaced by the Railway address.

Decisions (Nuno, 30/10/2026): Alice counts only simulations; type = line of insurance; owner = current owner; load red > 30% above average, orange 10-30%; open leads per person from the Supervisor Virtual's ticket copy; phone and email simulation requests count.

### Files changed
- `lib/zoho-desk/src/client.ts` — optional `customField` on `searchTicketsByChannel` (sent as `customField1`).
- `artifacts/api-server/src/leads/channels.ts` — 9 channels; `isLeadOf` matches a ticket against the channel it was fetched for.
- `artifacts/api-server/src/leads/tipo.ts` — new, lead-type rules.
- `artifacts/api-server/src/leads/service.ts` — per-channel fetch with custom field, agent names (1 h cache), DB state merge.
- `artifacts/api-server/src/leads/compute.ts` — filters, people load, type totals, email summary.
- `artifacts/api-server/src/leads/render.ts` — new sections, filters, columns.
- `artifacts/api-server/src/routes/leads.ts` — filters + `resumo.json`.
- `artifacts/api-server/src/storage/repo.ts` — `loadTicketStates(ids)`.
- `artifacts/api-server/src/lib/email-template.ts`, `README.md`, `.agents/skills/n8n-daily-summary-email/SKILL.md` — Replit → Railway.
- `artifacts/api-server/src/leads/leads.test.ts` — new tests.

### Requirement coverage
| Requirement / AC | Implemented | Developer test | Local result |
|---|---|---|---|
| Alice is a channel; only "Alice: Simulação" tickets count | Yes | isLeadOf tests | Pass |
| Phone and email simulation requests count (Tipo de Pedido = SIMULAÇÃO) | Yes | customField + isLeadOf tests | Pass (filter not run against live Desk) |
| Alice tickets not counted twice in Telefone | Yes | isLeadOf test | Pass |
| Lead type per lead (Auto, Habitação, Saúde, Vida, Empresas, Outros) | Yes | classifyTipo tests | Pass |
| Current owner per lead; "Sem responsável" when none | Yes | buildView test | Pass (names from live Desk not exercised) |
| Open leads per person from Supervisor Virtual copy | Yes | buildPeople test (open count) | Pass (DB lookup not exercised) |
| Load marker >30% red, 10-30% orange | Yes | buildPeople test | Pass |
| Filters canal / tipo / pessoa | Yes | applyFilters + buildView tests | Pass |
| Email data: channels + types, no names | Yes | buildEmailSummary test | Pass |
| New channels left out of month-on-month change | Yes | buildEmailSummary test | Pass |
| Page works at phone width | Yes | Playwright on sample render (400 px, no page overflow) | Pass |

### Tests executed
- `pnpm run typecheck` — all packages Done.
- `pnpm --filter @workspace/api-server exec vitest run` — 27 files, 424 tests passed.
- Sample render (120 fake leads) screenshotted at 1100 px and 400 px.

### Test data / preconditions
Production Desk (department Não Vida 367662000000006907) and the Supervisor Virtual DB. Desk env vars as today.

### User journeys QA must test
1. Open `/api/leads` (30 days). Check the 9 channels show, Alice/Telefone/Email included.
2. Open 3 Alice leads in the Desk via the table: each subject starts "Alice: Simulação".
3. Open 3 Telefone and 3 Email leads: each has Tipo de Pedido = SIMULAÇÃO and is not an Alice ticket.
4. Pick a person in "Pessoa" filter; every row in the table shows that person.
5. Compare one person's "em aberto" with the Desk (open tickets among their leads).
6. `GET /api/leads/resumo.json`: totals equal the sum of channels; no names in the JSON.

### Data that must be visually verified
KPI row 2 (abertos, sem responsável, média, >30%), Tipo de lead por canal table totals, Quem está a tratar as leads bars and pills, Canal × pessoa totals = leads total, lead table Tipo and Responsável columns.

### Permissions / roles to verify
`/leads` and `/leads/resumo.json` are public (as `/leads` was). The dashboard now shows people's names and loads to anyone with the link.

### Regression areas
Existing 6 channels counts (SITE "SITE:" rule, APRIL exclusion), weekly chart, pagination (now carries filters), daily leads email.

### Known risks
- Phone/email counts depend on the Desk search honouring `customField1=cf_negocio:SIMULAÇÃO` (not verified live) and on the auto-triage filling the field.
- Lead type is keyword-based; "Outros" may be large.
- Desk channel value for email tickets assumed to be "Email".
- Search results may not carry `assigneeId`/`statusType`; DB copy is the fallback.

### Assumptions
Average for the load marker uses people with ≥1 lead in the period (unassigned excluded). Vida team is not separated.

### Not verified
Live Desk responses for the 3 new searches; DB lookup in production; agent-name resolution; performance with 9 concurrent searches over 90 days.

### Suggested evidence for QA
Screenshots of the dashboard at 30 days (desktop + phone), the JSON response, 3 Desk tickets per new channel.

### Final status

**READY FOR INDEPENDENT QA**
