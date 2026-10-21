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
