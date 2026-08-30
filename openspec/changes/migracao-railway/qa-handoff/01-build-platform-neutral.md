# QA HANDOFF — Section 1: Make the build platform-neutral

Change: `openspec/changes/migracao-railway`
Branch: `claude/migracao-railway-httfsx`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Summary

Removed the build's hard dependency on Replit-only Vite plugins, and added a
`.env.example` documenting every environment variable the app reads.

`@replit/vite-plugin-runtime-error-modal` was imported statically and applied
unconditionally in `artifacts/supervisor/vite.config.ts`. It is now imported
dynamically inside the pre-existing
`NODE_ENV !== "production" && REPL_ID !== undefined` guard, alongside
`cartographer` and `devBanner`. A build outside Replit therefore never needs the
package to resolve. The packages stay in `devDependencies` (Replit remains the
rollback target).

No application code was touched. No API contract, analysis logic, schema, or
runtime behaviour changed.

## Files changed

| File | Change |
|---|---|
| `artifacts/supervisor/vite.config.ts` | dropped the static `runtimeErrorOverlay` import; the plugin is now dynamically imported inside the existing `REPL_ID` guard |
| `.env.example` (new) | documents `BASE_PATH`, `PORT`, `AGENT_EMAIL_MAP` and every other key read by `artifacts/api-server/src/lib/env.ts` |

## Requirement coverage

Acceptance criteria are the `#### Scenario:` blocks in
`openspec/changes/migracao-railway/specs/supervisor/spec.md`, verbatim. None of
them are satisfiable by section 1 alone — they all require the Express static
serving (section 2) and/or a deployed Railway service (sections 3–7). Listed in
full so coverage stays traceable across sections.

| Requirement / AC | Implemented | Developer test | Local result |
|---|---|---|---|
| Scenario: API and UI on one origin | No — section 2 | none | not exercised |
| Scenario: Existing server-rendered routes are unaffected | No — section 2 | none | not exercised |
| Scenario: Cron trigger after cutover | No — sections 3–7 | none | not exercised |
| Scenario: Health check | No — sections 3–7 | none | not exercised |
| Scenario: Same day analysed on both platforms | No — sections 5–7 | none | not exercised |

Section-1 tasks, which are build-plumbing rather than spec scenarios:

| Task | Implemented | Developer test | Local result |
|---|---|---|---|
| 1.1 `runtimeErrorOverlay()` inside the `REPL_ID`-guarded block | Yes | manual read of the built config + full build | pass |
| 1.2 `pnpm run build` succeeds with `REPL_ID` unset and `BASE_PATH=/` | Yes | `env -u REPL_ID BASE_PATH=/ PORT=8080 pnpm run build` | pass |
| 1.3 `BASE_PATH` in `.env.example` with a comment | Yes | file inspection | pass |

## Tests executed

```
pnpm install --frozen-lockfile                                  # ok (567 pkgs)
env -u REPL_ID BASE_PATH=/ PORT=8080 pnpm run build             # ok
```

`pnpm run build` runs `pnpm run typecheck` first, so the whole workspace
typechecked clean. Build output:

- `artifacts/api-server/dist/index.mjs` (2.7 MB) + pino worker bundles
- `artifacts/supervisor/dist/public/` — `index.html`, `assets/index-*.css` (111 kB), `assets/index-*.js` (635 kB)
- `artifacts/mockup-sandbox/dist/`

Negative check, to confirm the `PORT` guard is real:

```
cd artifacts/supervisor && env -u REPL_ID -u PORT BASE_PATH=/ npx vite build   # fails, as designed
```

There is no test suite for `vite.config.ts` and none was added — a unit test of a
Vite config is not meaningful; the build itself is the test.

## Test data / preconditions

None. Section 1 is build-time only; no database, no external service, no secrets.

Environment for a reproduction:
- Node 22.22.2 in this container (the project targets Node 24 — see Known risks)
- pnpm 10.33.0
- `REPL_ID` unset, `BASE_PATH=/`, `PORT` set to any positive integer

## User journeys QA must test

None for this section on its own. The regression to look for is:

1. On Replit (or with `REPL_ID` set and `NODE_ENV=development`), start the
   supervisor dev server and confirm the Replit runtime-error overlay still
   appears when a component throws.
2. With `REPL_ID` unset, run a production build and confirm the SPA still boots
   and renders in a browser from the built `dist/public`.

## Data that must be visually verified

None in this section — nothing renders data differently.

## Permissions / roles to verify

None — no auth surface touched.

## Regression areas

- **Replit dev experience.** The runtime-error overlay is now gated on
  `NODE_ENV !== "production" && REPL_ID !== undefined`. Previously it ran
  unconditionally, including in production builds. Production output no longer
  carries the overlay plugin's transform. This is the intended effect of task
  1.1, but it *is* a difference in the emitted production bundle versus the
  bundle currently on Replit.
- Vite plugin ordering: the overlay now runs after `react()` and `tailwindcss()`
  as before, but is grouped with the other Replit plugins. No observed effect.
- `mockup-sandbox` has its own Vite config and was not touched; it built fine.

## Known risks

- **`PORT` is required at build time.** `artifacts/supervisor/vite.config.ts`
  throws if `PORT` is unset, including for `vite build`. Railway injects `PORT`
  at runtime; it is not guaranteed in the build environment. If it is missing,
  the Railway build fails at task 3.4. The zero-behaviour-change fix is to set
  `PORT` as a Railway *service variable* (which is present at build time) rather
  than relying on the injected runtime value. Relaxing the guard in
  `vite.config.ts` would be a behaviour change and was **not** done — flagged for
  a decision instead.
- Node version drift: verification ran on Node 22, not the Node 24 the project
  pins. The build is not known to be version-sensitive, but this was not proven
  on 24.
- `.env.example` is new and untracked by any tooling — nothing validates it
  against `env.ts`, so it can drift.

## Assumptions

- `.env.example` did not previously exist anywhere in the repo (confirmed by
  `find . -name ".env*"`), so task 1.3 means creating it. I documented every key
  in `env.ts` plus `PORT`, `NODE_ENV` and `BASE_PATH`, not only `BASE_PATH`,
  because a file containing one variable would be misleading.
- Keeping the `@replit/*` packages in `devDependencies` is correct per
  `design.md` ("Removing them is a bigger diff for no benefit while Replit is
  still the rollback target").
- The example values in `.env.example` are placeholders; no real secret was
  written to it.

## Not verified

- That the Replit runtime-error overlay still works on Replit. Not reproducible
  here — there is no Replit environment in this container.
- That the production SPA bundle built *without* the overlay plugin behaves
  identically to the one currently deployed on Replit. The bundles differ by
  construction; only a browser check can confirm equivalence.
- Anything on Node 24.
- That Railway's build environment exposes `PORT`.
- Every spec scenario — none were exercised (see the coverage table).

## Suggested evidence for QA

- Build log from a clean checkout with `REPL_ID` unset, showing
  `pnpm run build` exiting 0 and emitting `artifacts/supervisor/dist/public`.
- Console/network screenshot of the built SPA loading with no runtime errors.
- On Replit with `REPL_ID` set: a screenshot of the runtime-error overlay firing
  on a deliberately thrown component error.
- A diff of `.env.example` keys against the `envSchema` keys in
  `artifacts/api-server/src/lib/env.ts`.

## Final status

**READY FOR INDEPENDENT QA**
