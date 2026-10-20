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

If you created the database before the execution module was merged, also run `database/migrations/001_add_worker_count.sql` once.

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

`algorithm` accepts `GREEDY` (default) or `KNAPSACK`. The response includes affected modules, selected tests, their scores, and a persisted `runId` for the execution module.

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

## Security

Never commit `.env` files, database passwords, or other secrets. Each team member must configure their own local credentials.

## Current Status

Project structure, initial MySQL schema and sample data, backend health endpoint, and database connection test are set up. Feature implementation is in progress.
