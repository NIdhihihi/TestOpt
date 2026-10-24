# TestOpt upload-first UML and DFD addendum

These diagrams revise the agreed ingestion/selection workflow while preserving the original actors, valuation, scheduling, approval, and feedback stages. Original PDFs remain unchanged. Random is removed; Branch and Bound is an optional bounded fixed-value selection strategy. SourcePlan/SourceVersion are the first adapter's persisted equivalents of the existing run/change/selected-test model; the manual catalog remains available.

## Activity

```mermaid
flowchart TD
  A[Developer selects project and uploads version] --> B[Validate files without executing source]
  B --> C{Supported adapter?}
  C -->|No| D[Explain limits and offer manual catalog]
  C -->|Yes| E[Discover imports and test files; compare versions]
  E --> F{Complete passing baseline and reliable evidence?}
  F -->|No| G[Full current suite is required]
  F -->|Yes| H[Find affected modules and candidate test files]
  G --> I[Four-factor valuation]
  H --> I
  I --> J[Auto Greedy or bounded DP; advanced bounded B&B]
  J --> K[Respect budget and explain incomplete validation]
  K --> L[LPT worker assignment]
  L --> M{Developer decision}
  M -->|Reject| N[Retain rejected plan; revise preferences]
  N --> J
  M -->|Approve| O[Queue immutable plan]
  O --> P[Run assigned files in isolated containers]
  P --> Q[Persist each actual file result and history]
  Q --> R[Show complete / incomplete / failed / error]
  Q --> S[Coverage evidence for the next version]
```

## Sequence

```mermaid
sequenceDiagram
  actor Developer
  participant UI
  participant API
  participant Analyzer
  participant DB
  participant Queue
  participant Worker
  participant Container
  Developer->>UI: Upload complete project folder version
  UI->>API: Authenticated files request
  API->>Analyzer: Validate, parse imports, discover tests, diff hashes
  Analyzer-->>API: Support status, graph, tests, changes, uncertainty
  API->>DB: Store immutable source version
  API-->>UI: Discovered project and changes
  Developer->>UI: Prepare automatic plan
  UI->>API: Version and saved preferences
  API->>DB: Read baseline coverage and test history
  API->>Analyzer: Impact, valuation, selection, scheduling
  API->>DB: Store immutable explained plan
  API-->>UI: Plan, limits, skipped files, comparisons
  Developer->>UI: Explicit approval
  UI->>API: Approve plan
  API->>DB: Atomically claim unsubmitted plan
  API->>Queue: Source plan ID
  Queue->>Worker: Execute approved plan
  par Each assigned worker
    Worker->>Container: Restricted container for assigned test file
    Container-->>Worker: Actual file result, duration, V8 coverage
    Worker->>DB: Persist result and eligible history update
  end
  Worker->>DB: Final status and baseline evidence
  UI->>API: Poll plan results
  API-->>UI: Independent outcomes and validation completeness
```

## State model

```mermaid
stateDiagram-v2
  [*] --> PLANNED
  PLANNED --> REJECTED: Developer rejects
  REJECTED --> [*]: Replanning creates a new immutable plan
  PLANNED --> QUEUED: Explicit approval
  QUEUED --> EXECUTING: Worker claims plan
  QUEUED --> ERROR: Queue/worker failure
  EXECUTING --> COMPLETED: Required checks pass with adequate evidence
  EXECUTING --> INCOMPLETE: Budget gap, skipped assertions, or missing test evidence
  EXECUTING --> FAILED: Actual assertion failure
  EXECUTING --> ERROR: Infrastructure error or timeout
  COMPLETED --> [*]
  INCOMPLETE --> [*]
  FAILED --> [*]
  ERROR --> [*]
```

Actual file results are PASSED, FAILED, ERROR, or NOT_RUN. A source plan never converts a suite command's aggregate exit status into fictitious individual assertion results. Node assertions are grouped into a test-file unit. The existing manual simulation state machine is retained separately.

## Class/component responsibilities

```mermaid
classDiagram
  class SourceVersion {
    versionId
    projectId
    previousVersionId
    filesAndHashes
    analysis
    coverageEvidence
  }
  class SourcePlan {
    planId
    immutableVersionId
    algorithmAndFormulation
    searchCompletion
    budgetAndWorkers
    assignments
    statusAndResults
  }
  class SourceAnalyzer {
    validateFiles()
    discoverImportsAndTests()
    compareVersions()
  }
  class SelectionStrategy {
    select(candidates, budget)
  }
  class GreedySelection
  class KnapsackDPSelection
  class BoundedBranchAndBound
  class SourceExecutionManager {
    executeApprovedPlan()
    recordFileResult()
    updateCoverageAndHistory()
  }
  SourceAnalyzer --> SourceVersion
  SourceVersion --> SourcePlan
  SourcePlan --> SelectionStrategy
  SelectionStrategy <|.. GreedySelection
  SelectionStrategy <|.. KnapsackDPSelection
  SelectionStrategy <|.. BoundedBranchAndBound
  SourceExecutionManager --> SourcePlan
  SourceExecutionManager --> SourceVersion
```

The JavaScript implementation exposes pure strategy functions rather than introducing unrelated class wrappers; the diagram describes responsibilities and interchangeability.

## DFD context and decomposition

```mermaid
flowchart LR
  Dev[Developer] -->|Source version / preferences / approval| T[TestOpt]
  TM[Test Manager] -->|Review or manual catalog corrections| T
  Admin[Administrator] -->|Accounts / workers / configuration| T
  T -->|Assignments| W[Isolated execution workers]
  W -->|Actual file results / coverage| T
  T -->|Explained plan / uncertainty / results / history| Dev
  T -->|Analytics and evidence| TM
```

```mermaid
flowchart TD
  U[Authenticated upload] --> P1[1 Validate and discover]
  P1 --> V[(D1 Immutable versions, graph and tests)]
  V --> P2[2 Detect changes and affected tests]
  H[(D2 Coverage evidence and history)] --> P2
  P2 --> P3[3 Value and select within budget]
  C[(D3 Preferences and constraints)] --> P3
  P3 --> P4[4 Schedule, explain and await approval]
  P4 --> P[(D4 Immutable plans and assignments)]
  P --> P5[5 Execute approved files]
  P5 --> W[Restricted containers]
  W --> P6[6 Validate and record actual results]
  P6 --> R[(D5 Results)]
  P6 --> H
  R --> P7[7 Report comparisons and completeness]
  P --> P7
```

In the original Level 1 numbering, ingestion/discovery extends processes 2.0/3.0 before 4.0 impact analysis; automatic policy belongs in 5.1/5.3; scheduling remains 6.0; per-file dispatch/recording remains 7.0; comparisons/history remain 8.0. Existing account/configuration processes are retained. Repository-provider webhooks are deferred and are not represented as implemented actors.
