# Delta for Supervisor — Migração Railway

## MODIFIED Requirements

### Requirement: Deployment platform and origin

The system MUST run as a single service on Railway, serving the API and the browser client from the same origin.

#### Scenario: API and UI on one origin

- GIVEN the service is deployed on Railway
- WHEN a browser loads the application root
- THEN the SPA is served by the same Express process that serves `/api/*`
- AND the session cookie set at login is accepted on subsequent `/api/*` requests without CORS configuration

#### Scenario: Existing server-rendered routes are unaffected

- GIVEN the SPA fallback is mounted
- WHEN a request arrives for `/leads`
- THEN the existing server-rendered HTML dashboard responds
- AND the SPA fallback does not intercept it

#### Scenario: Cron trigger after cutover

- GIVEN the n8n daily cron has been repointed to the Railway domain
- WHEN it POSTs to `/api/run` with the correct `X-Cron-Secret`
- THEN the analysis starts exactly as it did on Replit
- AND the response shape is unchanged

#### Scenario: Health check

- GIVEN Railway probes the service
- WHEN it requests `/api/health`
- THEN the service responds 200 once the HTTP listener is bound, without waiting for database setup to finish

## ADDED Requirements

### Requirement: No behaviour change during migration

The migration MUST NOT change any analysis output, API contract, or persisted schema.

#### Scenario: Same day analysed on both platforms

- GIVEN a date that was analysed on Replit
- WHEN the same date is opened on Railway after the data restore
- THEN the cached analysis is identical
- AND no LLM call is made
