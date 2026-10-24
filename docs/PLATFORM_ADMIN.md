# Shared worker administration

New registrations receive the global DEVELOPER role and OWNER membership in their own organization. Organization ownership does not grant access to shared worker administration.

A database administrator can explicitly grant platform access to a trusted existing account:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'trusted-admin@example.com';
```

Existing ADMIN roles are preserved for compatibility. Review accounts created before this change and demote those that should not manage shared workers.

## Validation

From `backend`, run `npm test`, `npm run check`, and `npm run test:integration:isolated`. The isolated suite creates a unique database, verifies migrations 007/008, runs the API tests with Redis intentionally unavailable, and removes the database. It requires local MySQL database-creation permission. It does not exercise a live Redis worker.

For an existing installation, apply migrations 007 and 008 only if their columns/table are missing; the current base schema already contains these fields. Earlier organization, audit, execution-job, and runner migrations (003-006) are also required. Do not blindly replay ALTER migrations on an already upgraded database.

## Live worker smoke test

With MySQL available and a disposable Redis instance listening on localhost port 6385, run `npm run test:smoke` from `backend`. Override `SMOKE_REDIS_URL` if needed. The harness uses a unique MySQL database and Redis queue, executes pass/fail/timeout fixtures, checks approval, CSV export, permissions, and deletion safeguards, then removes its database and queue. Ports 5001 and 6385 must be available.

For browser testing, run `node scripts-smoke.mjs --serve`; launch the frontend on port 5174 with `VITE_API_URL=http://127.0.0.1:5001/api`. Sign in with the disposable fixture account printed by the harness (password is in the harness source). Finish by creating `.testopt-smoke/stop` in the repository root; wait for the cleanup message before stopping the frontend. Remove a previous stop marker before starting another browser session.

Uploaded-project plans now use the independently attributed Node test-file adapter described in UPLOAD_WORKFLOW.md. Legacy catalog plans use explicitly labeled simulation. The former project-suite queue path is disabled because its exit status cannot establish each selected test's outcome.
