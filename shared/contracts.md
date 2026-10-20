# TestOpt Shared Contracts

## 1. Common Conventions

- Language: JavaScript ES modules
- IDs: strings
- Time units: minutes
- Priority: `HIGH`, `MEDIUM`, `LOW`
- Timestamps: ISO 8601
- Empty collections: `[]`
- Database fields use `snake_case`; JavaScript object fields use `camelCase`.
- Execution statuses: `PASSED`, `FAILED`, `ERROR`, `NOT_RUN`

## 2. Change Request

The optimization workflow accepts:

```js
{
  projectId: "P_TESTOPT",
  changedModuleIds: ["M_AUTH"],
  timeBudget: 15,
  workerCount: 2
}
```

- `projectId`: project being analyzed
- `changedModuleIds`: IDs of modules modified in the change
- `timeBudget`: maximum total execution time allowed for selected tests, in minutes
- `workerCount`: number of workers available for scheduling

## 3. Foundation → Optimization

The foundation module provides:

- `projectId`
- `modules`
- `dependencies`
- `tests`
- `coverage`
- `history`
- `changedModuleIds`
- `timeBudget`

### Module

- `moduleId`
- `moduleName`
- `criticality`

### Dependency

- `sourceModuleId`
- `targetModuleId`

A source module depends on its target module. Impact analysis traverses the reversed dependency graph to identify affected dependents.

### Test

- `testId`
- `testName`
- `executionTime`
- `priority`
- `status`

### Coverage

- `testId`
- `moduleId`
- `coverageWeight`

Coverage weights represent coverage strength, not failure probability.

### History

- `testId`
- `totalExecutions`
- `failureCount`
- `lastExecution`

If a test has never been executed, its failure rate is `0`.

## 4. Optimization → Execution

The optimization module provides:

- `runId`
- `projectId`
- `selectedTests`
- `workerCount`
- `timeBudget`

Each selected test contains:

- `testId`
- `executionTime`
- `priority`
- `score`
- `reason`
- `coveredModuleIds`

`score` represents the test's selection value as calculated by the optimization algorithm. `reason` explains why the test was selected. `coveredModuleIds` lists the relevant modules covered by that test.

The selected tests must fit within the configured time budget.

## 5. Execution → Analytics / History

Execution results use:

- `runId`
- `testId`
- `workerId`
- `executionStatus`
- `actualTime`
- `startedAt`
- `completedAt`

Execution statuses:

- `PASSED`
- `FAILED`
- `ERROR`
- `NOT_RUN`

Worker timeout or unavailability must not increase a test's failure count.

## 6. Shared Responsibilities

- Srushti maintains foundation data and provides the data required by optimization.
- Nidhi implements impact analysis, candidate retrieval, test valuation, Greedy selection, and the Knapsack DP benchmark.
- Shravani implements scheduling, simulated execution, and execution analytics.
- Each member must follow these contracts when integrating their module.
- Shared contract changes require agreement from all three members.
