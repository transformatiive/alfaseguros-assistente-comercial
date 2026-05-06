-- Migration: add totp_secret to users table
-- Applied: via direct SQL on dev DB; drizzle-kit push-force applies to other environments
-- Schema source of truth: lib/db/src/schema/users.ts

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
