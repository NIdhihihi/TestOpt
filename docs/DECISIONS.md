# Architecture Decisions

## ADR-001: React and Express are separate

The API can serve the workspace and future clients while workers remain independent.

## ADR-002: MySQL uses ordered migrations

SQL migrations make database changes explicit and repeatable across environments.

## ADR-003: Redis and BullMQ run executions

Queued jobs keep test commands out of the API process and allow workers to scale.

## ADR-004: NPM is the first runner

The runner is limited to safe NPM commands while the execution model matures.
