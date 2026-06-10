#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Idempotent SQL schema migrations.
# drizzle-kit push has ESM module-resolution issues; we apply migrations directly.
psql "$DATABASE_URL" -c "ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS team_summaries_json jsonb;"
