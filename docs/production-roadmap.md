# TestOpt production workflow

## Phase 1 — Platform foundation (in progress)

- Organizations, membership roles, and project ownership
- Account registration, login, and short-lived access tokens
- Password hashing, security headers, CORS restrictions, and rate limits
- Versioned database migrations and repeatable automated checks

## Phase 2 — Product workflow

- Signed-in frontend, organization switcher, and protected project catalog
- Project members and role-based permissions
- Run history, audit records, and project dashboards

## Phase 3 — Connected execution

- GitHub or GitLab webhook ingestion
- Change-to-module mapping and pull-request status reporting
- Test-runner adapters for Jest, Playwright, Cypress, and CI providers

## Phase 4 — Scale and operations

- Redis-backed job queues and stateless worker processes
- Docker development environment and production container images
- Managed MySQL, object storage for test artifacts, metrics, traces, and alerts
- Backups, retention policies, load tests, and deployment environments

## Delivery rule

Each phase is developed on `develop`, reviewed with passing automated checks, demonstrated locally, and merged to `main` only after acceptance.
