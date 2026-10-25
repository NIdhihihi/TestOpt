# TestOpt Architecture

## Components

- frontend: React and Vite workspace.
- backend: Express API, business logic, authentication, and queue integration.
- database: MySQL schema, sample data, and ordered migrations.
- Redis and worker: durable execution queue and NPM test runner.

## Request flow

User -> React workspace -> Express API -> MySQL

Queued execution:

Express API -> Redis queue -> worker -> configured NPM command -> MySQL results

## Rules

- Frontend code calls APIs only.
- Database operations stay server-side.
- Authentication and authorization are checked server-side.
- API input is validated before database changes.
- Background jobs run outside the API process.

## Source-upload adapter

React SourceWorkspace -> authenticated source API -> immutable source_versions -> AST dependency/version analysis -> explained planSource strategy policy -> source_plans -> explicit approval -> Redis -> sourceExecution -> resource-limited per-file Docker containers -> independently persisted results/source_test_history/coverage evidence. No uploaded project installation or script executes in the API or host. Source inspection uses @babel/parser. Uploaded content lives in project-scoped database snapshots and temporary worker materializations; container/source cleanup happens after execution. Legacy catalog plans continue through the simulated scheduling flow.
