---
name: DB push ESM issue
description: drizzle-kit push fails to resolve .js imports in ESM schema files; post-merge uses psql directly.
---

# drizzle-kit push broken for ESM schema files

## Rule
Do NOT rely on `pnpm --filter @workspace/db run push` in post-merge or elsewhere. Use `psql "$DATABASE_URL" -c "..."` with idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` statements instead.

**Why:** drizzle-kit's internal bundler cannot resolve `.js`-extension imports in TypeScript ESM source files (e.g. `import { conversationsTable } from "./conversations.js"`). The error is `Cannot find module './conversations.js'`. Node.js 24 is configured with `"type": "module"`, so `require()` in inline scripts also fails. psql is available in the Nix environment and is the simplest workaround.

**How to apply:** For every new column or table, write the SQL migration in `scripts/post-merge.sh` as an idempotent psql statement. Drizzle schema files are still the source of truth for TypeScript types; the SQL just ensures the DB catches up on deploy.
