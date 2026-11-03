# TestOpt evaluation: demo script and technical defence

Prepared from the current implementation on 28 October 2026. Read sections 1–4 first; use the remaining sections for questions. Older README status notes and docs/MEMORY.md do not describe the full current upload adapter.

## 1. Your opening explanation

“TestOpt is a change-aware regression test selection and execution optimizer. Running an entire regression suite after every small change can waste time. We compare uploaded source versions, discover dependencies, identify relevant test files, value them using relevance, criticality, historical failures and marginal coverage, and select within an estimated execution budget. We then distribute selected tests across workers, ask for approval, execute them in restricted containers, and retain actual results and coverage evidence for later versions.”

“The implemented adapter supports dependency-free JavaScript projects using Node’s built-in test runner. It is a deterministic optimization system, not a trained machine learning model. Selection reduces the work; scheduling reduces the elapsed time of that selected work.”

## 2. Get the demonstration ready

The initial readiness check found Docker Desktop’s Linux engine unavailable and no listeners on 5000, 5173, 3306 or 6379. Recheck after starting the services. Do this before the evaluation, not while explaining algorithms.

1. Start Docker Desktop and wait for its Linux engine to become ready.
2. Use your existing MySQL and Redis configuration. If they are managed by this repository’s Compose setup, run `docker compose up -d` from the repository root. Avoid starting a second database on an already occupied port.
3. Confirm the execution image exists: `docker image inspect node:24-alpine`. If absent, download it before the demo with `docker pull node:24-alpine`.
4. Keep the existing root `.env` private. Check that the configured MySQL database and Redis service match the ones you started. Do not replace working credentials with `.env.example` values.
5. If this database needs the upload tables, run `npm run db:upgrade` in backend. This is the documented additive upgrade; it does not replace every earlier migration. Do not reset the database for a demonstration.
6. Open separate terminals in backend for `npm run dev` and `npm run worker`.
7. Open a frontend terminal and run `npm run dev`.
8. Open http://localhost:5173 and verify http://localhost:5000/api/health. A health response alone does not prove that Docker, the queue and actual tests work.
9. Sign in. If creating an account, the UI requires a password of at least 12 characters. Rehearse an actual baseline execution before presenting.

Keep API and worker terminals available as evidence. The worker must remain running. A web page that can prepare a plan can still fail to execute it if Redis, the worker or Docker is unavailable.

## 3. The main demonstration: approximately 10–12 minutes

Use a NEW source project so old uploaded versions cannot change the comparison. Keep all three uploads in that SAME project. Use AUTO, 15 minutes and two workers initially. Upload each version folder itself, containing package.json; do not select their parent directory or the zip.

### Step A: establish trust with a full baseline

Create project `ShopCart Evaluation`. Upload `examples/shopcart-demo/v1-baseline`.

Say: “Inspection reads source text; it does not run uploaded code. The first version has no trustworthy passing baseline, so all six test files are required.”

Show discovered modules, test files and dependency edges. Prepare the optimizer’s plan. Show the reason for broad validation, selected tests, estimates, chosen policy and worker assignments. Review before approval, then approve execution. Wait for COMPLETED and baseline readiness. Expand test output and coverage evidence. The fixture has six test files containing 22 Node test cases; these are different granularities.

### Step B: demonstrate relevant-test selection

Upload `examples/shopcart-demo/v2-refactor` into the same project AFTER baseline completion.

Say: “Only src/discounts.js changed. The implementation changed from conditional coupon checks to a Map lookup while retaining behaviour. The affected tests are discounts.test.js and checkout.test.js because checkout depends on discounts.”

Prepare the plan. Expected: two selected files, four skipped files. Explain dependency evidence and earlier runtime coverage. Approve; both files should pass. Show history retaining the earlier version and its results.

Say: “We avoided four of six test files, a 66.7% reduction in file count for this change. This does not by itself establish a 66.7% runtime saving; test durations and container overhead differ.”

### Step C: prove execution detects a real regression

Upload `examples/shopcart-demo/v3-intentional-bug` after Step B completes.

Say: “This version deliberately changes SAVE10 from 10% to 15%. Existing tests retain the correct expectation. We expect the same two relevant files to expose the defect.”

Prepare, inspect and approve. Both relevant files are expected to fail. Expand the assertion output and connect it to the wrong coupon rate. Say: “FAILED here is the correct outcome: the testing system successfully detected an application regression.”

### Step D: additional controls if time permits

- Prepare another plan on the failed version with a tiny budget, such as 0.001 minutes. No tests may fit because learned estimates have a 0.01-minute floor. Show the budget conflict; approval is blocked when selection is empty.
- Explain that a nonempty partial plan can run, but passing it still leaves validation INCOMPLETE.
- Reject an unsubmitted plan and show that rejection does not execute anything.
- Download plan/results JSON and open history. Archive only at the end if you wish to demonstrate preservation; archiving blocks new uploads and runs.

Do not promise a particular algorithm’s runtime or optimality from this six-file demo. If all relevant candidates fit, selection uses an all-fit shortcut. This demonstrates change-based narrowing, not a hard constrained search.

## 4. Follow one request through the system

Browser upload -> authenticated Express route -> validate paths/content/limits -> SHA-256 per file -> Babel AST inspection -> compare against previous snapshot -> save version in MySQL.

Prepare plan -> combine static reachability and prior per-test runtime coverage -> determine required files or broaden validation -> build four-factor candidates -> choose selection policy -> enforce estimated budget -> LPT schedule -> persist PLANNED proposal.

Approve -> verify authorization and current state under database locks -> change to QUEUED -> enqueue BullMQ job in Redis -> worker claims job -> change to EXECUTING -> materialize source in a temporary directory -> execute assigned files in fresh Docker containers -> persist individual outcomes and history -> determine final status -> store reusable passing evidence if eligible.

The UI polls saved state every two seconds. The animated pipeline illustrates the workflow; the stored API plan and runner outputs provide the execution evidence.

## 5. Source comparison and impact: questions to expect

**How do you know a file changed?** A SHA-256 digest of its text is compared by relative path with the previous uploaded version. New path = added; same path/different digest = modified; missing old path = deleted. A rename is represented as deletion plus addition. Comments and whitespace can therefore trigger changes too; this is not semantic equivalence analysis.

**How do you discover dependencies?** Babel parses JavaScript into an abstract syntax tree. The walker recognizes imports, re-exports, literal require calls and dynamic import expressions. Relative imports are resolved against uploaded paths using supported filename alternatives. Built-ins are distinguished from external packages.

**How do you find indirect impact?** For each test, traverse its transitive import dependencies using a stack and visited set. If checkout.test imports checkout and checkout imports discounts, discounts is reachable from that test. A changed discounts module therefore makes checkout.test relevant. A visited set prevents infinite traversal through cycles.

**Is static analysis the same as coverage?** No. Static reachability says code may be involved. V8 runtime evidence says a module had executed ranges in a previous individual test-file run. The planner unions these sources. File execution evidence does not prove branch coverage or assertion quality.

**Why not skip when evidence is uncertain?** First upload, an unusable baseline, dynamic/computed loading, generated code, unresolved imports, runtime file/process access, changed configuration/assets/tests, and deletions broaden validation. Uncovered changed modules produce an evidence gap and prevent complete validation.

**What is a baseline?** Reusable evidence requires a complete passing result set with coverage for the previous version’s tests. After an eligible selective run, results for executed files are merged with retained prior evidence for unaffected tests. Unaffected files are not secretly re-executed.

**What if no source changed?** With a usable prior baseline, no required tests are selected and execution is unnecessary. Without usable evidence, validation must still be established.

## 6. The exact scoring model

For candidate test t and already selected set S:

`V(t | S) = 0.35 R(t) + 0.25 C(t) + 0.15 F(t) + 0.25 M(t | S)`

- Relevance R: sum of coverage weights times change damping, normalized by the maximum raw candidate relevance. Directly changed modules have damping 1; other relevant modules have damping alpha = 0.5.
- Criticality C: average of covered relevant modules’ criticality divided by 10.
- Failure F: failure_count / total_executions, or zero with no execution history. This is a historical frequency, not a calibrated probability of the next failure.
- Marginal coverage M: importance of relevant modules covered by this test that have not already been covered by S, divided by total relevant module importance.

`omega(module) = damping(module) × criticality(module)/10`

`M(t | S) = sum(omega of newly covered modules) / sum(omega of all relevant modules)`

`efficiency(t | S) = V(t | S) / estimated duration(t)`

The source adapter currently assigns module criticality 5/10, test priority MEDIUM and coverage weights 1. These are defaults, not inferred business knowledge. Thus source criticality does not distinguish candidates today. Test priority is separate from this four-factor value and from LPT scheduling.

Worked example: relevant modules A (changed) and B (indirect), both criticality 5. Their importance is 0.5 and 0.25; total importance is 0.75. T1 covers A and B; T2 covers A. Raw relevance is 1.5 and 1, hence normalized relevance is 1 and 2/3. With no failure history, T1 has initial value 0.35 + 0.125 + 0 + 0.25 = 0.725. T2 has approximately 0.23333 + 0.125 + 0 + 0.16667 = 0.525. If T1 is chosen first, T2’s marginal coverage becomes zero, leaving approximately 0.35833. T2 can still be useful because the other value components remain positive.

**Why these weights?** They are configurable implementation defaults encoding a design preference. Do not call them statistically learned or universally optimal. Validating alternative weights requires experiments and sensitivity analysis.

## 7. Selection algorithms and their limits

### Greedy

Choose the feasible test with greatest current marginal value per estimated minute, update covered modules, and repeat. A max-heap supports priority access. Lazy reevaluation updates a candidate’s stale efficiency when coverage has changed. Tests that cannot fit the remaining budget are skipped. A safeguard compares the resulting total marginal value against the best feasible single test.

Coverage overlap creates diminishing returns: covering an already covered module adds no further coverage value. The remaining relevance/criticality/history contribution can still add value. This explains why a fixed initial sort does not implement the same policy.

Greedy is a heuristic. Do not claim it always finds the optimal subset, or automatically attach a 1−1/e guarantee to this particular density-greedy implementation. Heap operations are logarithmic, but repeated marginal reevaluations and coverage traversal mean total runtime is not simply always O(n log n).

### Dynamic programming: 0/1 Knapsack

The fixed-value formulation maximizes `sum(value_i × x_i)` subject to `sum(cost_i × x_i) <= budget`, where each x_i is 0 or 1.

Recurrence: `DP[i,b] = max(DP[i−1,b], value_i + DP[i−1,b−cost_i])` when inclusion fits. Using the previous row prevents selecting one file repeatedly.

Costs use integer milliseconds; scores use five-decimal fixed values. Costs are compressed by their exact greatest common divisor. Dense DP requires O(nB') time and space for compressed capacity B'. When the table is too large, the implementation tries a sparse Pareto frontier, discarding cost/value states dominated by another state. Sparse growth can still be large. The default cap is one million dense cells or cumulative retained sparse states including history.

An explicit DP request that exceeds the allowance returns a resource error. AUTO catches this specific limit and explains a Greedy fallback. “Exact” refers to fixed additive scores in this discretized model; it does not mean optimal for changing marginal coverage or complete real-world fault detection.

### Branch and Bound

Explore include/exclude decisions. Sort by value density; compute a fractional-knapsack upper bound to discard branches that cannot beat the best feasible solution. Bounding uses actual integer costs/values and rational comparisons rather than rounded display efficiencies.

Default limits: 50,000 processed nodes or 2,000 ms. It reports provenOptimal only when search finishes without a cap. A capped search supplies a feasible best-found incumbent, not a proof. Worst-case search is exponential.

### AUTO policy

Overlapping candidate module coverage -> Greedy. Independent candidate coverage -> bounded-resource exact DP. DP resource limit -> explained Greedy fallback. Branch and Bound is an advanced manual override. AUTO is an explainable rule, not a model that predicts which algorithm will be fastest.

## 8. Scheduling, budget and metrics

Source plans use Longest Processing Time first (LPT): sort selected tests by decreasing estimated duration, then place each on the least-loaded worker using a min-heap. For n selected files and m workers, scheduling takes O(n log n + n log m), apart from surrounding metadata work.

Example: durations 8, 7, 6, 5 and two workers -> assign 8 to W1, 7 to W2, 6 to W2, 5 to W1. Loads become 13 and 13. Total work is 26, scheduled elapsed estimate is 13.

- Total estimated execution work = sum of selected durations.
- Makespan = maximum worker load.
- Utilization = total work / (worker count × makespan) × 100%.
- Imbalance = maximum load − minimum load.
- Lower bound = max(total work / worker count, longest single test).

Budget applies to total estimated selected work, not makespan. A 15-minute budget with two workers does not authorize 30 minutes of selected tests. Actual durations can differ, and Docker startup adds wall-clock overhead. Do not describe the selection budget as an enforced global runtime deadline.

One queue worker process normally handles one plan, but that plan may contain 1–4 logical execution workers. Each logical worker executes its assigned files sequentially; logical workers run concurrently. These are distinct concepts from WORKER_CONCURRENCY, which controls concurrent queue jobs per worker process.

The manual scheduler also exposes FCFS (cyclic assignment in this code), PRIORITY and GREEDY. Source execution uses LPT. Explain the implemented definitions instead of assuming their names imply an operating-system scheduler.

## 9. Execution, statuses and security

**Are tests actually run?** Yes, source plans run selected files with `node --test --test-reporter=tap` in a fresh Docker container per file. Legacy manual tools have a simulated workflow and must be labelled accordingly.

**How is coverage attributed?** Each selected file has its own container and V8 coverage directory. The trusted harness extracts executed project module paths and returns that file’s output, timing and status. The displayed assertionCount comes from Node’s TAP test count; it is not an instrumented count of every assertion statement.

**What prevents uploaded scripts from running during analysis?** Inspection parses strings; it does not invoke npm install, package scripts or a project command. Execution calls a trusted driver and node:test directly after approval.

**What restrictions apply?** No network, non-root UID/GID 65534, read-only source and container root, dropped capabilities, no new privileges, one CPU, 256 MB memory with matching memory-swap limit, 64-process limit, and a limited /tmp filesystem. The test child has an 8-second timeout; the Docker command has a 20-second deadline. Containers and temporary materializations are cleaned up. These are per-file restrictions, not a global budget timer or a guarantee of production-grade hostile tenant isolation.

**What do statuses mean?** PLANNED -> QUEUED -> EXECUTING -> final status. REJECTED is an alternative from PLANNED. Infrastructure/runner problems produce ERROR; assertion failures produce FAILED. COMPLETED requires the plan to cover its required checks without a coverage gap and every selected file to pass with coverage evidence. Otherwise a successful partial run remains INCOMPLETE. A file with no executed tests or skipped/todo tests is NOT_RUN. Error takes precedence over failed when aggregating.

**Who can access a project?** JWT validation establishes the user. A server-side project/organization membership query separately checks authorization. Source routes currently allow OWNER, ADMIN, TEST_MANAGER and DEVELOPER organization roles. Browser visibility is not the security boundary. Access tokens expire after 15 minutes, so be prepared to sign in again during a long evaluation.

**What about invalid uploads?** The server checks safe relative paths, case-insensitive duplicates, excluded sensitive paths/types, allowed text types and file limits: 1–300 files, 512 KB per file, 5 MB per project. Unsupported dependencies/frameworks are disclosed; accepted inspection does not imply executable support. SQL values use placeholders.

**What about double approval and crashes?** Approval locks project/plan rows and checks state; it also blocks another active plan in the same project. The worker checks QUEUED state under a lock. Redis enqueue failure is recorded as ERROR. Database commit and queue enqueue are separate operations; there is no transactional outbox, so do not claim crash-proof exactly-once dispatch or execution. Encountering an already EXECUTING plan is treated as an interrupted-worker error rather than silently rerunning it.

## 10. Data model and design choices

- source_versions stores project-scoped uploaded files, analysis, previous-version links and reusable evidence. File snapshots and comparison history are retained; evidence can be updated after eligible execution.
- source_plans stores the saved proposal, version/project identity, status, results and error information.
- source_test_history stores per-project test-path execution counts, failures, learned time and last execution. The learned estimate uses the latest measured result with a minimum floor, not an ML prediction or moving average.
- Projects belong to organizations; organization memberships supply access roles. Archiving preserves records and blocks new work.
- MySQL supplies relationships, persistent history and transactions. Redis/BullMQ provides background job delivery. The API returns before long execution completes; the worker performs the expensive work.
- This is local upload/version ingestion. Git webhooks, broad language/framework support, dependency installation and production deployment are future scope.

## 11. Mentor questions that expose overclaims

**Is a green result proof there are no bugs?** No. It means the selected required checks passed under the available evidence and policy. Tests may miss assertions or dependencies; skipped files were not rerun.

**How is this different from just parallel testing?** Parallelism changes scheduling. TestOpt also reduces the candidate set using changes and evidence, then selects within budget before scheduling.

**Do you generate tests?** No. This adapter discovers and executes uploaded existing tests.

**Does critical code always get selected?** No absolute guarantee. Criticality contributes to score; time feasibility and other factors affect selection. Missing required checks is disclosed as incomplete.

**Why require baseline coverage if imports are known?** Imports alone are conservative and cannot capture every runtime relationship. Earlier measured evidence supplies additional context, while uncertainty still triggers broader checks.

**Can two tests covering the same file find different bugs?** Yes. Module overlap is not assertion equivalence. We reduce only the marginal coverage contribution, not all value of the second test. Under sufficient budget all relevant candidates are selected.

**Does comparing Greedy and DP scores prove one is better?** Only under the same objective and constraints. The UI’s fixed-value score comparison does not prove optimality for Greedy’s dynamic marginal objective.

**Is the UI’s runAll the entire uploaded suite?** The current source planner compares against all relevant candidates. On a narrowed version that may already be only two files. Use the six-file baseline separately when explaining whole-suite reduction.

**Is staticPriority an independent priority experiment?** In this source adapter all test priorities are MEDIUM, and the planner’s staticPriority comparator fills shortest tests first. Do not describe that row as a validated business-priority baseline.

**What is your evidence for speed or quality?** Show actual demo durations, selected file counts, test outcomes and exported records. The existing BENCHMARK_REPORT explicitly predates the current precision/DP changes. Its synthetic historical results cannot establish current production performance or defect-detection accuracy.

**What is novel here?** The project combines version inspection, conservative impact evidence, an explained four-factor policy, budgeted selection, parallel scheduling, approval and per-file execution history in one workflow. Do not claim invention of Greedy, Knapsack, LPT or coverage analysis.

**What would you improve next?** More adapters, richer and version-aware evidence, stronger assertion/branch evidence, business-criticality inputs, calibrated duration estimates, transactional queue dispatch, baseline refresh policy and evaluation on larger real suites.

## 12. Source files to open when asked “where is that?”

| Concern | Repository path |
|---|---|
| Main UI, authentication, API calls, polling | frontend/src/App.jsx |
| UI derived state and upload preparation | frontend/src/workspaceModel.js |
| Upload validation, hashes, Babel inspection, reachability | backend/src/services/sourceAnalysis.js |
| Baseline policy, required tests, AUTO, plan completeness | backend/src/services/sourcePlanner.js |
| Scoring, heap Greedy, DP and bounded B&B | backend/src/services/optimizationService.js |
| Integer duration conversion and budget checks | backend/src/services/duration.js |
| LPT, min-heap and scheduling metrics | backend/src/execution/scheduler.js |
| Source upload/plan/approve/reject/export APIs | backend/src/routes/source.js |
| BullMQ consumer | backend/src/worker.js |
| Parallel assignments, persistence and evidence merging | backend/src/services/sourceExecution.js |
| Docker arguments, deadlines and cleanup | backend/src/execution/sourceRunner.js |
| node:test child, TAP parsing and V8 evidence | backend/src/execution/source-driver.cjs |
| Identity and membership checks | backend/src/middleware/auth.js and authorization.js |

For an unexpected question: state the behaviour, explain its mechanism, point to the code or observed result, then state the limitation. “That is not currently implemented; here is our supported boundary” is stronger than an invented answer.
