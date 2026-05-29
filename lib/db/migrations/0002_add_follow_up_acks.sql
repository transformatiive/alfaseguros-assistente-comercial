-- Migration: follow_up_acks table for n8n follow-up emission tracking
-- Tracks which follow-up promises have been emitted to Zoho Desk.
-- Applied via: psql $DATABASE_URL < lib/db/migrations/0002_add_follow_up_acks.sql
-- Or: drizzle-kit push (post-merge.sh handles this).

CREATE TABLE IF NOT EXISTS follow_up_acks (
  id                SERIAL PRIMARY KEY,
  follow_up_id      TEXT NOT NULL UNIQUE,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  desk_task_id      TEXT NOT NULL,
  emitted_at        TIMESTAMPTZ NOT NULL,
  dedup             TEXT,
  completed_at      TIMESTAMPTZ,
  completed_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS follow_up_acks_conversation_id_idx ON follow_up_acks(conversation_id);
CREATE INDEX IF NOT EXISTS follow_up_acks_desk_task_id_idx    ON follow_up_acks(desk_task_id);
