# TestOpt

### Change-Aware Test Case Selection & Execution Optimizer

TestOpt is a software testing optimization tool that selects relevant test cases for changed modules under a specified execution-time budget and schedules selected tests across available workers.

## Project Structure

- `backend/` — Express.js REST API, queue worker, database migrator, and unit/integration suites (`backend/src/**/*.test.js`, `backend/src/integration/`)
- `frontend/` — React UI and unit tests (`frontend/src/*.test.js`)
- `database/` — MySQL 8.4 schema, ordered migrations, and sample seed data
- `shared/` — Contracts and conventions shared across the team
- `scripts/` — Synthetic academic benchmark and evaluation suite
- `examples/` — Standalone demo projects (such as `examples/shopcart-demo/`)
- `docs/` — Project documentation and architecture specs

## Technology Stack

- Frontend: React, Vite
- Backend: Node.js, Express.js
- Database: MySQL 8.4
- Database driver: mysql2
- Queue / Cache: Redis 7.4, BullMQ

## Prerequisites

Install Node.js (v22+), npm, MySQL Server 8.4 (or Docker Desktop for Compose + sandboxed test execution).

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/NIdhihihi/TestOpt.git
cd TestOpt
```

### 2. Configure the backend

```bash
cd backend
npm install
```

Create a `.env` file in the project root using `.env.example` as a reference. Set your MySQL credentials, `REDIS_URL`, and a `JWT_SECRET` of at least 32 characters.

### 3. Set up the database (unified migration runner)

All fresh installs, upgrades, Docker initialization, and integration tests use the same migration ledger (`schema_migrations`) in [`backend/src/db/migrator.js`](backend/src/db/migrator.js):

* **Option A — Docker Compose (MySQL 8.4 + Redis + automatic migration & seed):**
  ```bash
  docker compose up -d
  ```
  The `migrate` service waits for MySQL to become healthy, initializes or upgrades the schema via `migrator.js`, and seeds sample data only if the database has no projects yet.

* **Option B — Existing local MySQL instance:**
  From `backend/`:
  ```bash
  # Fresh install: creates DB if needed, applies baseline + pending migrations, then seeds sample data
  npm run db:setup

  # Existing install: reconciles legacy tables cleanly and applies pending migrations without deleting data
  npm run db:upgrade
  ```

### 4. Run the backend

From the `backend/` directory:

```bash
npm run dev
```

The backend runs at `http://localhost:5000`.

Health check: `http://localhost:5000/api/health`

### Optimization API

Submit a change for impact analysis and test selection:

```http
POST /api/optimization/optimize
Content-Type: application/json

{
  "projectId": "P_TESTOPT",
  "changedModuleIds": ["M_AUTH"],
  "timeBudget": 15,
  "workerCount": 2,
  "algorithm": "GREEDY"
}
```

`algorithm` is the selection algorithm and accepts `GREEDY` (default) or `KNAPSACK`. The response includes `selectionAlgorithm`, affected modules, selected tests, their scores, and a persisted `runId` for the execution module. Execution separately records its scheduling strategy (`FCFS`, `PRIORITY`, `GREEDY`, or `LPT`).

### 5. Run the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Team Workflow

- `main` — stable version
- `develop` — shared integration branch
- `feature/foundation` — foundation and data management
- `feature/optimization` — impact analysis and test selection
- `feature/execution` — scheduling, execution, and analytics

Create feature branches from the latest `develop` branch. Commit work to your own feature branch and open a pull request into `develop` after testing.

## Continuous Integration

GitHub Actions runs on pushes (`main`, `develop`, `feature/**`, `fix/**`, `codex/**`) and pull requests to `develop` or `main`. It checks backend syntax and unit tests, runs the isolated database migration and API integration suite against a `mysql:8.4` service container (`npm run test:integration:isolated`), and runs frontend tests, linting, and production builds.

Run the database-backed integration suite locally against disposable databases after MySQL is running:

```bash
cd backend
npm run test:integration:isolated
```

It verifies both legacy schema upgrades and fresh installs via the migration runner, then tests optimization, scheduling, invalid input, unavailable workers, and simulated worker errors without mutating your development database.

## Security

Never commit `.env` files, database passwords, or other secrets. Each team member must configure their own local credentials.

## Current Status

Project structure, initial MySQL schema and sample data, backend health endpoint, and database connection test are set up. Feature implementation is in progress.

## Upload-first workflow

Start with [the upload workflow guide](docs/UPLOAD_WORKFLOW.md) and [the agreed SRS/UML/DFD scope addendum](docs/AGREED_SCOPE.md). Progress and acceptance evidence are tracked in TASKS.md.

Supported source folders contain dependency-free JavaScript and node:test files. TestOpt discovers imports/tests, compares uploaded versions, chooses a selection algorithm, requests approval, and executes assigned test files independently inside restricted Docker containers. A complete passing baseline is required before narrowing a later version. Unsupported projects remain inspectable with an explanation and a manual-catalog fallback. Random is excluded; Greedy, DP, and optional bounded Branch and Bound remain.

Existing installations: run `npm run db:upgrade` in backend to add archive/source tables without removing data. Pull `node:24-alpine`, start Redis/API/worker, and start the frontend. Source plans are separate from legacy manual-catalog simulation. Archive projects to retain their history.
