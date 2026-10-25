# Test Plan

## Automated checks

- Backend syntax: npm run check
- Scheduler tests: npm test
- Database and queue integration: npm run test:integration
- Frontend lint and production build: npm run lint and npm run build

## Core flows

- Registration, login, and organization access.
- Catalog creation and editing.
- Optimization and schedule preview.
- Queued execution and persisted results.
- Run history and analytics.

## Manual checks

- Desktop and narrow mobile layouts.
- Protected routes for signed-out users.
- Invalid catalog and runner inputs.
