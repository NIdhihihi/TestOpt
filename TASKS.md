# TestOpt delivery checklist

Agreed target: upload-first supported JavaScript/node:test projects, automatic discovery and version comparison, explained automatic selection, strict budgets, approval, isolated test-file execution, and history feedback. Preserve existing work. Random is removed; Branch and Bound is an optional bounded fixed-value strategy. Do not commit until Git staging is authorized again.

## Sequential delivery tasks

- [x] T01 Record revised scope, acceptance criteria, and SRS/UML/DFD addendum; preserve original PDFs.
- [x] T02 Archive projects and preserve history; block new runs for archived projects.
- [x] T03 Validate bounded folder uploads; discover supported files and test files without executing code.
- [x] T04 Infer local dependencies and detect added/modified/deleted files; expose uncertainty and manual fallback.
- [x] T05 Execute baseline test files in resource-limited Docker containers; capture durations and coverage independently.
- [x] T06 Choose Greedy/DP automatically; retain bounded B&B overrides and completion metadata; exclude Random.
- [x] T07 Generate change-driven plans; broaden validation for incomplete evidence; enforce approval and budget/incomplete-result rules.
- [x] T08 Execute actual selected test files on assigned workers; record independent results/history, never copy suite outcomes.
- [x] T09 Build simple upload/analyze/review/approve/results UI with advanced controls and saved preferences.
- [x] T10 Compare genuine run-all/static-priority baselines with consistent objectives and metrics.
- [x] T11 Verify units, isolated database migrations/APIs, real Docker execution, unsupported inputs, version changes, timeouts, and frontend.
- [x] T12 Update setup/user documentation and record evidence and remaining limitations.

First adapter: dependency-free JavaScript projects with Node's built-in test runner, at test-file granularity. Git-provider integration and additional runners follow this release. The older tasks below remain a backlog, not an assertion of current implementation status.

## Subsequent milestones

- [x] F01 Rebuild dashboard, test suite, run history, and 3D data city from the four supplied HTML references; connect real uploads/plans/results and preserve approval and advanced tools.
- [x] F02 Verify frontend data semantics, production build, lint, and browser navigation/filtering/approval against disposable live demo runs.

- [ ] GitHub/GitLab connection, webhook ingestion, and CI reports.
- [ ] Additional languages/frameworks and controlled package installation.
- [ ] Project invitations and expanded organization administration.
- [ ] Deployment isolation, production quotas, monitoring, backups, retention, and load testing.

## Verification evidence

- Pure analyzer/planner regressions cover unsafe files, dependency cycles, version changes, missing baselines, package support, dynamic imports, budget conflicts, and DP rounding.
- The disposable database suite verifies archive preservation, authentication/authorization, source upload, B&B metadata, and no fabricated results when Redis is unavailable.
- The live Redis/Docker smoke establishes a two-file baseline, selects one affected file on the next version, verifies independent failure/timeout outcomes, and confirms infrastructure errors do not change failure-history counters.
- Browser validation uses disposable source folders and a separate database/API/frontend; source data from existing projects is not used.
- Original PDFs remain unchanged. The addendum describes the user-approved changes.
- Working changes remain uncommitted because Git staging permission was previously declined.

Final verification: 40 backend unit tests and 13 isolated API tests pass; backend syntax checks, frontend build/lint, live Redis/Docker baseline/change/failure/timeout/archive checks, and browser upload/reject/approve/change-subset checks pass. Local schema was upgraded without deleting existing data. Production deployment and additional adapters remain in the subsequent milestones.
