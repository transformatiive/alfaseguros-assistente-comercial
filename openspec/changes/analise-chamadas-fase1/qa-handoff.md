# Análise de Chamadas · Fase 1 (Visão geral) — QA handoff

Plan: https://claude.ai/artifact/GBV13JYJBW6z9AsmnAvukL · Prototype: https://claude.ai/artifact/WSV3HYaihG6Z6vkot32ovj

## QA HANDOFF

### Summary
New top menu "Análise de Chamadas" in the Supervisor Virtual. Phase 1 delivers the "Visão geral" tab, built on every Ringover call (answered or not), split by team. The other four tabs show a "chega na fase X" notice. No LLM calls.

### Files changed
- `lib/db/src/schema/chamadas_ringover.ts` (new tables `chamadas_ringover`, `chamadas_ringover_dias`), `lib/db/src/schema/index.ts`
- `artifacts/api-server/src/lib/setup-chamadas-ringover.ts` (CREATE IF NOT EXISTS at startup)
- `artifacts/api-server/src/analise-chamadas/normalizar.ts`, `agregar.ts`, `analise-chamadas.test.ts`
- `artifacts/api-server/src/storage/chamadas-ringover-repo.ts`
- `artifacts/api-server/src/jobs/sync-chamadas-ringover.ts`; `jobs/analyze-day.ts` (stores the day's calls, best effort)
- `artifacts/api-server/src/routes/analise-chamadas.ts`, `routes/index.ts`, `index.ts` (startup backfill of last 35 days)
- `artifacts/api-server/src/lib/teams.ts` (`isTeam360Name`)
- `artifacts/api-server/src/routes/pre-visualizacao.ts` (guard scoped to its own path, see Known risks)
- `artifacts/supervisor/src/pages/analise-chamadas.tsx`, `lib/use-analise-chamadas.ts`, `App.tsx`, `components/layout.tsx`, `index.css`

### Requirement coverage

| Requirement / AC (decisions of 30/10/2026) | Implemented | Developer test | Local result |
|---|---|---|---|
| Macro view from Ringover API, replaces the Replit ringover-analytics | Yes | normalizar + agregar unit tests | Pass |
| Sinistros counts as Equipa 360 | Yes | resolverEquipa test | Pass |
| Equipa Vida = colaboradores with equipa vida (11 in seed) | Yes | resolverEquipa test | Pass |
| Everyone else counts as Corporate, for now | Yes (admin, mkt, unknown users) | resolverEquipa test | Pass |
| Corporate: only in the macro view, for now | Yes (chip + table row, no own tab) | Visual | Checked on screenshot |
| Default view last 30 days; custom start and end dates for older periods | Yes; missing days are pulled in the background | lerPeriodo test; Playwright run | Pass |
| Colour targets: atendidas 90/80, espera 20/30 s, clientes que insistem 3/6 % | Yes | Visual | Checked on screenshot |
| Everyone sees everything | Yes (any logged-in user) | curl 401 without session | Pass |
| Hover values, animation, works on mobile | Yes | Playwright 1366 px and 390 px, no page overflow | Pass |

### Tests executed
- `pnpm --filter @workspace/api-server run test`: 23 files, 382 tests pass (22 new).
- `pnpm run typecheck`: pass. `BASE_PATH=/ pnpm run build`: pass.
- Local Postgres + built server + seeded fake calls: API totals match a direct SQL count (880 in / 440 out / 82.3 %).
- Playwright: login, open menu, hover bar shows tooltip, team chip filter, inverted dates warning, placeholder tabs; scrollWidth equals viewport at 390 px.

### Test data / preconditions
- Railway env: `RINGOVER_API_KEY` (already set) for the background pull. `CRON_WEBHOOK_SECRET` only for the manual sync endpoint.
- First start after deploy pulls the last 35 days from Ringover in the background (a few minutes). Until then the page says days are missing.

### User journeys QA must test
1. Log in, open "Análise de Chamadas": default "Últimos 30 dias", all teams.
2. Click each team chip; KPIs, charts and person table change; team table stays full.
3. "Datas…": pick a period older than 35 days; the page shows "A buscar N dias" and fills itself in.
4. Pick "Ontem" on a Monday: shows Sunday (expected few or no calls, empty-state message).
5. Hover/tap bars in both charts; tooltip text is correct and stays inside the screen.
6. Phone width: no sideways scroll of the page; tables scroll inside their card.
7. Run the daily cron (`POST /api/run`): log shows "análise de chamadas: dia sincronizado".

### Data that must be visually verified
- Recebidas/feitas/atendidas for one day vs the Ringover dashboard for the same day.
- Team of 3 known people: one 360, one Sinistros (must show 360), one Vida.
- "Sem pessoa atribuída" row: count of missed calls with no user.

### Permissions / roles to verify
- No session: GET returns 401. Sync endpoint: 401 without the right `X-Cron-Secret`.

### Regression areas
- Daily run (`analyzeDay`): extra DB write right after the Ringover fetch; wrapped in try/catch.
- `pre-visualizacao` router: guard now only on `/agente/pre-visualizacao/*`. With the flag off, every later `/api` route (stats, conversations, summary…) used to answer 404 locally; production likely has the flag on.
- Top menu on mobile now scrolls sideways.

### Known risks
- Wait time uses `answered_time - start_time`, else `queue_duration`/`ringing_duration`. Field names for the fallback are not confirmed against a live payload.
- "Caixa de voz" is detected from `last_state` containing voicemail/message. If Ringover uses another value, those calls fall into "Não atendidas".
- Calls missed on a shared line with no user only appear under "Todas as equipas".
- Ringover history depth for older periods is unknown; days that fail are retried after 1 hour.

### Assumptions
- 360 people not yet in `colaboradores` are matched by name (list in `lib/teams.ts`).
- "Últimos 30 dias" = the 30 calendar days ending yesterday.

### Not verified
- No call to the real Ringover API (no key in the dev environment). Sync is only exercised with fake rows.
- Not run on Railway; the startup table creation was only run on local Postgres 16.
- Real call volumes over a full year (performance of the 366-day maximum).
- Accessibility audit beyond keyboard focus on bars.

### Suggested evidence for QA
- Screenshot of one day next to the Ringover dashboard for the same day.
- `select count(*) from chamadas_ringover_dias` after first deploy (expect ~35).
- Railway log lines for the startup backfill and the daily run.

### Final status

**READY FOR INDEPENDENT QA**
