# TestOpt

### Intelligent Test Case Selection & Execution Optimizer

TestOpt is a software testing optimization tool that selects relevant test cases for changed modules under a specified execution-time budget and schedules selected tests across available workers.

## Project Structure

- `backend/` — Express.js REST API and backend logic
- `frontend/` — React user interface
- `database/` — MySQL schema and sample data
- `shared/` — Contracts and conventions shared across the team
- `tests/` — Unit and integration tests
- `docs/` — Project documentation

## Technology Stack

- Frontend: React, Vite
- Backend: Node.js, Express.js
- Database: MySQL
- Database driver: mysql2

## Prerequisites

Install Node.js, npm, and MySQL Server 8.0 or a compatible version.

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

Create a `.env` file in the project root using `.env.example` as a reference. Set your own local MySQL credentials.

### 3. Set up the database

Run the SQL files from your MySQL client, in this order:

1. `database/schema.sql`
2. `database/seed.sql`

If you created the database before the execution module was merged, also run these files once, in order:

1. `database/migrations/001_add_worker_count.sql`
2. `database/migrations/002_separate_selection_and_scheduling_algorithms.sql`

The sample data includes modules, dependencies, test cases, coverage mappings, execution history, and workers.

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

GitHub Actions runs on every push and pull request to `develop` or `main`. It installs exact dependencies, checks backend syntax, runs backend tests, then lints and builds the frontend. Wait for both checks to pass before merging a pull request.

Run the database-backed integration suite locally after MySQL is configured:

```bash
cd backend
npm run test:integration
```

It tests optimization, scheduling, invalid input, unavailable workers, and simulated worker errors. It restores temporary run data, worker statuses, and test history when complete.

## Security

Never commit `.env` files, database passwords, or other secrets. Each team member must configure their own local credentials.

## Current Status

Project structure, initial MySQL schema and sample data, backend health endpoint, and database connection test are set up. Feature implementation is in progress.

## Upload-first workflow

Start with [the upload workflow guide](docs/UPLOAD_WORKFLOW.md) and [the agreed SRS/UML/DFD scope addendum](docs/AGREED_SCOPE.md). Progress and acceptance evidence are tracked in TASKS.md.

Supported source folders contain dependency-free JavaScript and node:test files. TestOpt discovers imports/tests, compares uploaded versions, chooses a selection algorithm, requests approval, and executes assigned test files independently inside restricted Docker containers. A complete passing baseline is required before narrowing a later version. Unsupported projects remain inspectable with an explanation and a manual-catalog fallback. Random is excluded; Greedy, DP, and optional bounded Branch and Bound remain.

Existing installations: run `npm run db:upgrade` in backend to add archive/source tables without removing data. Pull `node:24-alpine`, start Redis/API/worker, and start the frontend. Source plans are separate from legacy manual-catalog simulation. Archive projects to retain their history.
