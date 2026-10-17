# TestOpt Shared Contracts

## Common conventions

- Language: JavaScript ES modules
- IDs: strings
- Time units: minutes
- Priority: HIGH, MEDIUM, LOW
- Timestamps: ISO 8601
- Empty collections: []

## Change request

- projectId
- changedModuleIds
- timeBudget
- workerCount

## Foundation -> Optimization

- projectId
- modules
- dependencies
- tests
- coverage
- history
- changedModuleIds
- timeBudget

## Optimization -> Execution

- runId
- projectId
- selectedTests
- workerCount
- timeBudget

Each selected test contains:

- testId
- executionTime
- priority
- score
- reason
- coveredModuleIds

## Execution statuses

- PASSED
- FAILED
- ERROR
- NOT_RUN

Update this document whenever all three members agree to change a shared contract.
