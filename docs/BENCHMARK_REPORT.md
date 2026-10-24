# TestOpt Benchmark Report

Generated: 2026-10-24T12:10:27.238Z / v24.11.1 / win32 x64

## Method

Deterministic synthetic inputs; single-run timings are observations, not performance guarantees. Budget FIFO selects tests within budget rather than running the entire suite. Quality uses the same static F1 coefficients for all algorithms, including greedy; it does not certify the dynamic marginal-coverage objective. Branch-and-bound is proven optimal only when search finishes without a cap.

## Runtime (milliseconds)

Tests | Candidates | Greedy | B&B | DP | Priority | Budget FIFO
--- | --- | --- | --- | --- | --- | ---
100 | 92 | 2.93 | 0.69 | 22.15 | 16.54 | 0.2
500 | 420 | 4.13 | 3.51 | GUARD_TRIGGERED | 0.74 | 0.05
1000 | 812 | 2.23 | 4.16 | GUARD_TRIGGERED | 0.57 | 0.07
2500 | 2064 | 3.68 | 2.26 | GUARD_TRIGGERED | 0.89 | 0.05
5000 | 3901 | 2.87 | 5.37 | GUARD_TRIGGERED | 4.38 | 0.12

## Memory storage models (MB)

Estimates, not measured heap usage. DP assumes 16 bytes/cell; greedy 64 bytes/candidate. B&B includes a conservative quadratic allowance for copied partial combinations. Object overhead and garbage collection vary. Guarded DP instances are not allocated.

Budget | DP model | B&B model | Greedy model | DP guarded
--- | --- | --- | --- | ---
10 | 7 | 1.6213 | 0.0279 | false
25 | 17.48 | 1.6213 | 0.0279 | true
50 | 34.95 | 1.6213 | 0.0279 | true
100 | 69.89 | 1.6213 | 0.0279 | true
200 | 139.78 | 1.6213 | 0.0279 | true

## Static F1 quality

Tests | Budget | B&B reference | Proven optimal | Greedy | Priority | Budget FIFO | Greedy/reference
--- | --- | --- | --- | --- | --- | --- | ---
50 | 20 | 8.37 | true | 8.2396 | 6.76 | 5.1493 | 98.44%
100 | 20 | 12.4701 | true | 12.4425 | 7.5829 | 2.0404 | 99.78%
200 | 20 | 14.8528 | true | 14.7161 | 7.4086 | 3.1865 | 99.08%
300 | 20 | 17.6575 | true | 17.587 | 10.6657 | 5.7958 | 99.6%
500 | 20 | 18.5919 | true | 18.42 | 10.3774 | 4.5976 | 99.08%

Observed greedy/reference range: 98.44% to 99.78%. Capped references are incumbents, not certified optima.

## Scheduling

For fractional minutes, LB = max(sum(durations) / workers, longest duration). Ratios to LB do not prove a theorem against the unknown optimal makespan. Imbalance is maximum minus minimum load in minutes.

Workers | LB (min) | FCFS | Priority | Greedy | LPT | LPT utilization
--- | --- | --- | --- | --- | --- | ---
2 | 10.435 | 11 | 10.46 | 10.59 | 10.44 | 99.95%
4 | 5.2175 | 5.65 | 5.24 | 5.48 | 5.33 | 97.89%
8 | 2.60875 | 3.18 | 2.64 | 2.91 | 2.77 | 94.18%
16 | 1.30438 | 1.77 | 1.44 | 1.65 | 1.46 | 89.34%

## Synthetic failure-history ablation

Latent defects are simulated, not measured production bugs. Results apply to these inputs only.

Budget | Latent defects | Caught with history | Caught without history | Relative gain
--- | --- | --- | --- | ---
15 | 228 | 24 | 16 | 50%
30 | 228 | 30 | 26 | 15.4%
45 | 228 | 43 | 31 | 38.7%
60 | 228 | 51 | 40 | 27.5%
