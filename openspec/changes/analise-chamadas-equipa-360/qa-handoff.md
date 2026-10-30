# Análise de Chamadas · Equipa 360 — QA handoff

## QA HANDOFF

### Summary
The "Equipa 360" tab of Análise de Chamadas now shows what the daily AI analysis found for the 360 team (Sinistros included), joined with the Desk cases. Read-only, no LLM calls, no new tables.

### Files changed
- `artifacts/api-server/src/analise-chamadas/agregar-360.ts` + `agregar-360.test.ts` (new)
- `artifacts/api-server/src/storage/chamadas-ringover-repo.ts` (`carregarConversasComCaso`)
- `artifacts/api-server/src/routes/analise-chamadas.ts` (`GET /api/analise-chamadas/equipa-360`)
- `artifacts/supervisor/src/lib/use-analise-chamadas.ts`, `pages/analise-chamadas.tsx`

### Requirement coverage

| Requirement / AC | Implemented | Developer test | Local result |
|---|---|---|---|
| 360 view includes Sinistros | Yes | agregar-360 test | Pass |
| AI quality, failures, outcome with Desk tickets, per person (plan, phase "Equipa 360") | Yes | agregar-360 tests | Pass |
| Colour targets: quality 85/70 % of scale, sem ticket 5/10 % | Yes | Visual | Checked on screenshot |
| Last 30 days by default, custom dates | Yes (shared period filter) | lerPeriodo test | Pass |
| Works on mobile | Yes | Playwright 390 px, scrollWidth 390 | Pass |

### Tests executed
- `pnpm --filter @workspace/api-server run test`: 24 files, 390 tests pass (8 new).
- `pnpm run typecheck`: pass. Build: pass.
- Local Postgres with 60 fake conversations / 50 cases / 45 tickets: API counts match the seed (15 without ticket = 5 cases without ticket + 10 conversations without case).
- Playwright: tab opens, list link goes to `/conversas/:id`, no page errors.

### Test data / preconditions
Needs conversations with `analysis_json` from the daily run and cases from the Desk linking.

### User journeys QA must test
1. Open Análise de Chamadas → Equipa 360 with the default period.
2. Change the period; numbers change.
3. Click a conversation in "Conversas para rever na reunião"; the conversation detail opens.
4. Phone width: no sideways scroll of the page.

### Data that must be visually verified
- Count of conversations vs the Resumo Diário for the same days (360 only).
- A Sinistros person (if any in `colaboradores` with equipa sinistros) appears in the 360 table.
- "Sem ticket no Desk" for one person vs the Desk.

### Permissions / roles to verify
- Without a session the endpoint answers 401.

### Regression areas
- Visão geral tab (shared page and filters).

### Known risks
- Failures are grouped by the AI's free-text title (accents, case and articles ignored). Two different wordings of the same failure still show as two rows.
- A conversation counts as 360 from its agent (roster, then the 360 name list). Agents unknown to both are not in this tab.

### Assumptions
- Quality targets: 4.25 / 3.5 out of 5 (85 % / 70 %, same as the guião targets).

### Not verified
- Against production data (local fake data only).
- Performance over a full year of conversations.

### Suggested evidence for QA
- Screenshot of the tab next to the Resumo Diário for one day.
- API response for one week.

### Final status

**READY FOR INDEPENDENT QA**
