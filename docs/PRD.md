# TestOpt Product Requirements

## Product

TestOpt selects and schedules the most relevant tests after a code change.

## Users

- Test managers maintain projects, modules, tests, dependencies, and coverage.
- Developers submit changed modules for optimization.
- Owners configure runners and review execution quality.

## Current scope

- Organization accounts, authentication, and project roles.
- Project catalog management.
- Impact traversal, greedy and knapsack selection, and scheduling.
- Run history, analytics, queued execution, and NPM runner configuration.

## Out of scope

- GitHub or GitLab webhook ingestion.
- Runners beyond NPM.
- Billing and public multi-tenant deployment.

## Success criteria

- Authorized users can configure a project catalog.
- A change produces a valid selected test set within the requested budget.
- Users can review, execute, and audit a run.
