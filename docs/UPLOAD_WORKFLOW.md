# Upload-first TestOpt

## Supported projects

The first adapter supports dependency-free JavaScript using Node's built-in `node:test` framework. A test case is a test file; assertions within that file run together. Recognized names are `*.test.js`, `*.test.mjs`, `*.test.cjs`, and `*.spec.*`. Upload the folder containing package.json at its root. An example is `backend/src/integration/fixtures/demoProject.js` (the fixture exported there describes a complete five-file project).

Projects needing npm dependencies, TypeScript/JSX compilation, Jest, browser frameworks, native binaries, external services, or package installation need another adapter. The inspection screen explains unsupported inputs. The advanced manual catalog and simulated worker flow remain available. No project install or uploaded script runs during inspection.

## Setup

1. Existing installations require migrations 007/008 from the earlier work, and organization/audit/runner/job tables. After backing up normally, run `npm run db:upgrade` from backend to add archive/source tables only when missing. It retains existing data. New installations run schema.sql, seed.sql, migrations 003-006, and `npm run db:upgrade` (the base schema already incorporates older structural changes).
2. Start MySQL, Redis, the API, and `npm run worker`. Both API and worker must use the same DB and Redis configuration.
3. Pull the official execution image once: `docker pull node:24-alpine`. Execution uses `--pull=never`; it never downloads an image or npm packages on a user's approval request.
4. Start the frontend. The default API is localhost:5000/api; override VITE_API_URL for a separate test environment.

By default each worker process handles one source plan at a time, with up to four assigned file containers; WORKER_CONCURRENCY can be explicitly configured for a larger trusted environment.

Docker worker: mount uploaded files read-only and run each selected test file in a fresh container. Disable network, drop capabilities, prohibit privilege escalation, use a non-root user, cap CPU/memory/processes, and impose test/container timeouts. Source is materialized in a dedicated temporary directory and removed after execution. Containers are removed after each file. A Docker daemon is a trusted worker prerequisite; this local model is not a claim of production hostile-tenant isolation.

## Normal workflow

Create/select a project -> upload folder -> review detected modules, tests, imports and support warnings -> prepare an automatic plan -> approve -> view actual results. The first version needs a complete passing baseline and coverage evidence. After a source change, upload the complete new folder version. TestOpt identifies additions, modifications and deletions and uses imports plus previous coverage to determine candidates. Uploading again does not modify older versions or results.

Known uncertainty (dynamic imports, runtime filesystem/process access, unresolved imports, configuration/test changes, deleted files, incomplete/failing baselines) broadens validation. Missing coverage is not interpreted as proof that no tests are needed. If changed code has no test evidence, results remain incomplete even after the available suite passes. Coverage of a file records execution evidence, not proof of assertion quality or complete branch coverage.

Discovered source modules currently use default criticality 5/10 and test files use MEDIUM priority; those defaults are disclosed instead of pretending to infer business importance. Execution durations are learned from file results.

Auto chooses overlap-aware Greedy or bounded DP for independent fixed-value instances. Advanced settings expose Greedy, DP, and bounded Branch and Bound. B&B reports whether its search completed. LPT assigns selected files across 1-4 workers. Most recent plan budget/worker settings are reused. Estimated selected duration stays within budget; actual runtime is measured independently and can vary. When required files do not fit, the plan and its results stay incomplete. Users must explicitly approve any execution; a rejected plan does not run.

View old plans and export the complete plan/results as JSON. Archive rather than delete a project: files, versions, plans, legacy runs, and execution history remain readable, while uploads/new runs are blocked. Source history is separate from the legacy manual catalog analytics.

## Repeatable validation

- `npm test` and `npm run check` in backend.
- `npm run test:integration:isolated`: disposable MySQL schema/migrations and APIs, including deliberate offline Redis behavior.
- `npm run test:smoke`: real Redis at localhost:6385 (or SMOKE_REDIS_URL), disposable database/queue, real Node containers, baseline, one-file change selection, independent failure/timeout, budget conflict, archive safeguards and export. It removes its database and queue. Start a dedicated Redis with `docker run --detach --rm --name testopt-smoke-redis --publish 127.0.0.1:6385:6379 redis:7.4-alpine` and stop that named container afterward.
- Frontend: `npm run build`, `npm run lint`, then browser sign-in/upload/plan/approval/results checks.

## Deferred scope

Git-provider connections/webhooks, more language/framework adapters, package installation, production-grade multi-tenant isolation, deployment, CI status reporting, external-service fixtures, and baseline refresh policies are subsequent work. Source upload/version comparison is the implemented entry point. Original SRS/UML/DFD PDFs are preserved; AGREED_SCOPE.md is the revision addendum.

Implementation references: Node's [V8 coverage interface](https://nodejs.org/api/cli.html#node_v8_coveragedir) and Docker [resource limits](https://docs.docker.com/engine/containers/resource_constraints/).
