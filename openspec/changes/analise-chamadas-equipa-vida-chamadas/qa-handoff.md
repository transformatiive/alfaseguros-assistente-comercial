# QA handoff · Análise de Chamadas fases 5 (Equipa Vida) e 6 (Chamadas)

**Status: READY FOR INDEPENDENT QA**

## What changed
- Vida team Ringover calls are now scored with the same guião as the SolidNetworks campaign.
  They live in `chamadas_sftp` with `fonte = 'ringover'` (`ficheiro = 'ringover:<call_id>'`).
  New columns: `fonte`, `agente_id`, `gravacao_url` (startup ALTER IF NOT EXISTS + Drizzle schema).
- Job `jobs/guiao-vida-ringover.ts`: 3 min after start (30-day backfill), then every 3 h (last 2 days).
  Max 300 analyses per run. Off with `VIDA_GUIAO_AUTOMATICO=0`. Env: `VIDA_GUIAO_DIAS`, `VIDA_GUIAO_MAX_POR_EXECUCAO`.
  Calls < 30 s = `curta`; no transcript after 3 days or < 15 words = `descartada`.
- API:
  - `/api/chamadas-sftp/resumo|chamadas` accept `fonte=ringover` (list also `fonte=todas`, `pessoa=`).
  - Detail returns `fonte`, `temGravacao`, `lead` (noCRM lead matched by recording mp3 name).
  - Ringover audio = 302 to the Ringover CDN; transcript fetched live from Ringover.
  - `POST /api/chamadas-sftp/processar-vida` (X-Cron-Secret).
  - `GET /api/analise-chamadas/equipa-vida`, `GET /api/analise-chamadas/lista`.
- UI: "Equipa Vida" tab (KPIs, per-person table with weakest guião point and calls without lead, the guião
  screen with Ringover source) and "Chamadas" tab (one list, filters by source/team/person, Excel export;
  Supervisor rows open `/conversas/:id`, guião rows open the guião sheet).

## Checks run
- `pnpm run typecheck`: pass. `vitest`: 33 files, 485 tests pass (new: agregar-vida, lista, guiao-vida-ringover).
- `BASE_PATH=/ pnpm run build`: pass.
- Local Playwright at 1366 px and 390 px with fake Ringover guião rows and fake noCRM events:
  both tabs render, no page errors, no horizontal scroll, detail sheet shows noCRM lead link.

## Not verified
- Real Ringover transcripts and audio redirect (no API key locally).
- Real cost of the first backfill run in production.
- Campanha Vida (sftp) behaviour is meant to be unchanged; regression check recommended.
