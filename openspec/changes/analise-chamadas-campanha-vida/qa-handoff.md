# Análise de Chamadas · Campanha Vida — QA handoff

## QA HANDOFF

### Summary
The "Campanha Vida" tab shows the SolidNetworks recordings scored against the guião (same screens as the SFTP portal: resumo, one view per call type, all calls, call detail with audio and transcript). The portal's existing analyses are imported once at startup, with no new LLM calls. The Supervisor's own analysis stays off (`SFTP_ANALISE_AUTOMATICA=0`) until the portal's analysis is switched off, so nothing is paid twice.

### Files changed
- Restored from commit 1344543: `artifacts/api-server/src/chamadas-sftp/*`, `jobs/chamadas-sftp.ts`, `lib/setup-chamadas-sftp.ts`, `routes/chamadas-sftp.ts`, `storage/chamadas-sftp-repo.ts`, `lib/db/src/schema/chamadas_sftp.ts`
- New: `chamadas-sftp/importar-portal.ts` (+ test), `jobs/importar-portal-sftp.ts`
- `lib/env.ts` (SFTP_S3_*, OPENROUTER_MODEL_SFTP, SFTP_ANALISE_AUTOMATICA, PORTAL_SFTP_EXPORT_URL/TOKEN), `index.ts` (startup), `routes/index.ts`
- `lib/openrouter/src/types.ts` (sonnet-5.5 / haiku-5.5 prices)
- UI: `artifacts/supervisor/src/pages/campanha-vida.tsx`, `lib/use-chamadas-sftp.ts`, `pages/analise-chamadas.tsx`
- Portal side: transformatiive/sftp-server-as PR #12 (`GET /admin/analise/exportar.json`, token guarded)

### Requirement coverage

| Requirement / AC | Implemented | Developer test | Local result |
|---|---|---|---|
| Campanha Vida tab inside Análise de Chamadas | Yes | Playwright | Pass |
| Existing SolidNetworks analyses migrated into the Supervisor DB | Yes (import from portal export) | importar-portal tests + local fake portal | 60 received, 60 inserted; restart: 60 kept |
| Import never re-pays the LLM | Yes | Code path has no LLM call | Pass |
| Import never overwrites a finished Supervisor analysis | Yes | importar-portal test | Pass |
| Uses page period (last 30 days default, custom dates) | Yes | Visual | Pass |
| Guião colour targets 85/70 % | Yes | Visual | Pass |
| Mobile | Yes | Playwright 390 px, scrollWidth 390 | Pass |

### Tests executed
- `pnpm --filter @workspace/api-server run test`: 26 files, 411 tests pass.
- `pnpm run typecheck`: pass. `pnpm run build`: pass.
- Local: Postgres + fake portal export (60 calls, destaques). Tab, type view, call list, call detail sheet open with no page errors at 1366 and 390 px.
- Portal PR #12: new tests pass; `upload inbox moves finished files` already fails on main (unrelated).

### Test data / preconditions
Railway env (not set yet):
- Portal: `ANALISE_EXPORT_TOKEN`.
- Supervisor: `PORTAL_SFTP_EXPORT_URL=https://<portal>/admin/analise/exportar.json`, `PORTAL_SFTP_EXPORT_TOKEN` (same value), `SFTP_S3_ENDPOINT`, `SFTP_S3_BUCKET`, `SFTP_S3_ACCESS_KEY_ID`, `SFTP_S3_SECRET_ACCESS_KEY` (for audio and transcripts).

### User journeys QA must test
1. Análise de Chamadas → Campanha Vida: KPIs, destaques, charts.
2. Click a call type; click a count; the list opens; click a call; audio plays; "Ver transcrição" shows text.
3. Change the period; numbers change.
4. Exportar Excel downloads a CSV that opens with accents.
5. Restart the service: the import says "mantidas", no duplicates.

### Data that must be visually verified
- Counts and % for one week vs the portal's own screen for the same week.

### Permissions / roles to verify
- `/api/chamadas-sftp/*` answers 401 without a session.
- `POST /api/chamadas-sftp/importar-portal` and `/processar` need the cron secret.
- Portal export: 404 without env, 401 without/with wrong token.

### Regression areas
- Visão geral and Equipa 360 tabs (same page).
- Daily Ringover run (startup order).

### Known risks
- Audio and transcript need the SFTP_S3_* vars; without them the tab shows data but audio fails.
- Calls the portal marked "analisada" without a valid type are stored as "erro".

### Assumptions
- The portal export format is `/data/analise/chamadas.json` as written by the portal today.

### Not verified
- Against production data and the real bucket.

### Final status

**READY FOR INDEPENDENT QA**
