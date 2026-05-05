import { pool } from "@workspace/db";
import { logger } from "./logger.js";

const CREATE_SESSION_TABLE = `
  CREATE TABLE IF NOT EXISTS "user_sessions" (
    "sid"    varchar      NOT NULL COLLATE "default",
    "sess"   json         NOT NULL,
    "expire" timestamp(6) NOT NULL
  ) WITH (OIDS=FALSE);

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'session_pkey'
        AND conrelid = 'user_sessions'::regclass
    ) THEN
      ALTER TABLE "user_sessions"
        ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
`;

export async function setupSessionStore(): Promise<void> {
  try {
    await pool.query(CREATE_SESSION_TABLE);
    logger.info("Session store ready");
  } catch (err) {
    logger.error({ err }, "Failed to create session store table");
    throw err;
  }
}
