
import { Router } from "express";
import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";
import { createSchedule } from "./scheduler.js";

const router = Router();
const VALID_STRATEGIES = new Set(["FCFS", "PRIORITY", "GREEDY", "LPT"]);
// Temporarily remember plans that the developer has reviewed.
const approvedPlans = new Map();

function getStrategy(value) {
  const strategy = String(value ?? "FCFS").toUpperCase();

  if (!VALID_STRATEGIES.has(strategy)) {
    const error = new Error(
      `strategy must be one of: ${[...VALID_STRATEGIES].join(", ")}`
    );
    error.statusCode = 400;
    throw error;
  }

  return strategy;
}


function getWorkerFailurePercent() {
  const percent = Number(
    process.env.SIMULATED_WORKER_FAILURE_PERCENT ?? 0
  );

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(
      "SIMULATED_WORKER_FAILURE_PERCENT must be between 0 and 100"
    );
  }

  return percent;
}


function simulateStatus() {
  // Configurable probability thresholds, expressed as percentages.
  // Defaults: 90% PASSED, 7% FAILED, 3% ERROR.
  const failedPercent = Number(process.env.SIMULATED_FAILURE_PERCENT ?? 7);
  const errorPercent = Number(process.env.SIMULATED_ERROR_PERCENT ?? 3);

  if (
    !Number.isFinite(failedPercent) ||
    !Number.isFinite(errorPercent) ||
    failedPercent < 0 ||
    errorPercent < 0 ||
    failedPercent + errorPercent > 100
  ) {
    throw new Error("Invalid simulation outcome percentages");
  }

  const value = Math.random() * 100;

  if (value < errorPercent) return "ERROR";
  if (value < errorPercent + failedPercent) return "FAILED";
  return "PASSED";
}

async function getPlan(connection, runId, strategy) {
  const [runs] = await connection.query(
    `SELECT run_id, project_id, status
     FROM optimization_runs
     WHERE run_id = ?`,
    [runId]
  );

  if (runs.length === 0) {
    const error = new Error(`Optimization run ${runId} was not found`);
    error.statusCode = 404;
    throw error;
  }

  const [tests] = await connection.query(
    `SELECT
       st.test_id AS testId,
       tc.execution_time AS executionTime,
       tc.priority AS priority,
       st.score AS score,
       st.selection_reason AS reason
     FROM selected_tests st
     JOIN test_cases tc ON tc.test_id = st.test_id
     WHERE st.run_id = ?
     ORDER BY st.test_id`,
    [runId]
  );

  if (tests.length === 0) {
    const error = new Error("This run has no selected tests");
    error.statusCode = 400;
    throw error;
  }

  const [workers] = await connection.query(
    `SELECT worker_id AS workerId, worker_status AS workerStatus
     FROM workers
     WHERE worker_status = 'AVAILABLE'
     ORDER BY worker_id`
  );

  if (workers.length === 0) {
    const error = new Error("No available workers");
    error.statusCode = 409;
    throw error;
  }

  const plan = createSchedule({
    selectedTests: tests,
    workers,
    strategy,
  });

  return { run: runs[0], tests, workers, plan };
}

// Preview a plan without executing tests or changing run status.
// POST /api/execution/:runId/plan
// Body: { "strategy": "GREEDY" }
router.post("/:runId/plan", async (req, res) => {
  try {
    const strategy = getStrategy(req.body?.strategy);
    const connection = await pool.getConnection();

    try {
      const { run, plan } = await getPlan(
        connection,
        req.params.runId,
        strategy
      );

      if (["RUNNING", "COMPLETED"].includes(run.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot preview execution for a run that is ${run.status}`,
        });
      }
      const approvalToken = randomUUID();

      approvedPlans.set(approvalToken, {
        runId: req.params.runId,
        strategy,
        signature: JSON.stringify(plan),
        expiresAt: Date.now() + 10 * 60 * 1000, // expires in 10 minutes
      });

      return res.json({
        success: true,
        approved: false,
        approvalToken,
        runId: req.params.runId,
        strategy,
        plan,
        message: "Review this plan before approving execution.",
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Plan preview error:", error);
    return res.status(error.statusCode ?? 500).json({
      success: false,
      message: error.statusCode ? error.message : "Could not create plan",
    });
  }
});


/**
 * Compare all scheduling strategies using the same selected tests
 * and the same available workers. This endpoint does not modify the DB.
 *
 * POST /api/execution/:runId/compare
 */
router.post("/:runId/compare", async (req, res) => {
  let connection;

  try {
    connection = await pool.getConnection();

    // Fetch the test set and available workers once so every strategy
    // is evaluated against the same inputs.
    const [runs] = await connection.query(
      `SELECT run_id, project_id, status
       FROM optimization_runs
       WHERE run_id = ?`,
      [req.params.runId]
    );

    if (runs.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Optimization run ${req.params.runId} was not found`,
      });
    }

    const [tests] = await connection.query(
      `SELECT
         st.test_id AS testId,
         tc.execution_time AS executionTime,
         tc.priority AS priority,
         st.score AS score,
         st.selection_reason AS reason
       FROM selected_tests st
       JOIN test_cases tc ON tc.test_id = st.test_id
       WHERE st.run_id = ?
       ORDER BY st.test_id`,
      [req.params.runId]
    );

    if (tests.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This run has no selected tests",
      });
    }

    const [workers] = await connection.query(
      `SELECT worker_id AS workerId, worker_status AS workerStatus
       FROM workers
       WHERE worker_status = 'AVAILABLE'
       ORDER BY worker_id`
    );

    if (workers.length === 0) {
      return res.status(409).json({
        success: false,
        message: "No available workers",
      });
    }

    const strategies = ["FCFS", "PRIORITY", "GREEDY", "LPT"];

    const comparisons = strategies.map((strategy) => {
      const plan = createSchedule({
        selectedTests: tests,
        workers,
        strategy,
      });

      return {
        strategy,
        metrics: plan.metrics,
        workers: plan.workers,
        schedule: plan.schedule,
      };
    });

    // Smallest makespan is best for completion time.
    const bestMakespan = Math.min(
      ...comparisons.map((item) => item.metrics.makespan)
    );

    return res.json({
      success: true,
      runId: req.params.runId,
      testCount: tests.length,
      availableWorkerCount: workers.length,
      comparisons,
      bestMakespanStrategies: comparisons
        .filter((item) => item.metrics.makespan === bestMakespan)
        .map((item) => item.strategy),
      message:
        "Strategies compared using the same selected tests and available workers. No execution results or run status were changed.",
    });
  } catch (error) {
    console.error("Strategy comparison error:", error);

    return res.status(error.statusCode ?? 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Could not compare scheduling strategies",
    });
  } finally {
    connection?.release();
  }
});


// Execute only when the caller explicitly confirms the plan.
// POST /api/execution/:runId
// Body: { "strategy": "GREEDY", "approved": true }
router.post("/:runId", async (req, res) => {
  let strategy;

  try {
    strategy = getStrategy(req.body?.strategy);
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({
      success: false,
      message: error.message,
    });
  }

  if (req.body?.approved !== true) {
    return res.status(400).json({
      success: false,
      message: "Execution requires explicit plan approval.",
    });
  }

  const approvalToken = req.body?.approvalToken;
  const approval = approvedPlans.get(approvalToken);

  if (
    !approval ||
    approval.runId !== req.params.runId ||
    approval.strategy !== String(req.body?.strategy ?? "FCFS").toUpperCase() ||
    approval.expiresAt < Date.now()
  ) {
    return res.status(400).json({
      success: false,
      message: "Plan approval is missing, expired, or does not match this run and strategy. Preview the plan again.",
    });
  }


  let workerFailurePercent;

  try {
    workerFailurePercent = getWorkerFailurePercent();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }


  const runId = req.params.runId;
  const startConnection = await pool.getConnection();

  let plan;
  let workerQueues;
  let workerIds;

  try {
    await startConnection.beginTransaction();

    const [runs] = await startConnection.query(
      `SELECT run_id, status
       FROM optimization_runs
       WHERE run_id = ?
       FOR UPDATE`,
      [runId]
    );

    if (runs.length === 0) {
      await startConnection.rollback();
      return res.status(404).json({
        success: false,
        message: `Optimization run ${runId} was not found`,
      });
    }

    if (["RUNNING", "COMPLETED"].includes(runs[0].status)) {
      await startConnection.rollback();
      return res.status(409).json({
        success: false,
        message: `Run ${runId} is already ${runs[0].status}`,
      });
    }

    const [existing] = await startConnection.query(
      `SELECT test_id
       FROM test_executions
       WHERE run_id = ?`,
      [runId]
    );

    if (existing.length > 0) {
      await startConnection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "This run already has recorded results. Create a new run to retry tests without altering immutable history.",
      });
    }

    const [tests] = await startConnection.query(
      `SELECT
         st.test_id AS testId,
         tc.execution_time AS executionTime,
         tc.priority AS priority,
         st.score AS score,
         st.selection_reason AS reason
       FROM selected_tests st
       JOIN test_cases tc ON tc.test_id = st.test_id
       WHERE st.run_id = ?
       ORDER BY st.test_id`,
      [runId]
    );

    if (tests.length === 0) {
      await startConnection.rollback();
      return res.status(400).json({
        success: false,
        message: "This run has no selected tests",
      });
    }

    const [workers] = await startConnection.query(
      `SELECT worker_id AS workerId, worker_status AS workerStatus
       FROM workers
       WHERE worker_status = 'AVAILABLE'
       ORDER BY worker_id
       FOR UPDATE`
    );

    if (workers.length === 0) {
      await startConnection.rollback();
      return res.status(409).json({
        success: false,
        message: "No available workers",
      });
    }

    plan = createSchedule({ selectedTests: tests, workers, strategy });

    if (JSON.stringify(plan) !== approval.signature) {
    await startConnection.rollback();

    return res.status(409).json({
      success: false,
      message: "The plan has changed since preview. Preview and approve the updated plan again.",
    });
  }

  // Approval is single-use.
  approvedPlans.delete(approvalToken);

    // Build a separate simulated timeline for each worker.
    workerQueues = plan.workers.map((worker) => ({
      workerId: worker.workerId,
      tests: worker.tests,
    }));
    workerIds = workers.map((worker) => worker.workerId);

    await startConnection.query(
      `UPDATE optimization_runs
       SET status = 'RUNNING', algorithm = ?
       WHERE run_id = ?`,
      [strategy, runId]
    );

    await startConnection.commit();
  } catch (error) {
    await startConnection.rollback();
    console.error("Could not start execution:", error);
    return res.status(error.statusCode ?? 500).json({
      success: false,
      message: error.statusCode ? error.message : "Could not start execution",
    });
  } finally {
    startConnection.release();
  }


  const executionResults = [];
  const workerFailures = [];
  const simulatedWorkerErrors = [];

  // Each worker queue runs independently. A simulated worker failure
  // marks that queue's tests ERROR, while preserving all saved results.
  await Promise.all(
    workerQueues.map(async (queue) => {
      let workerClock = Date.now();

      const workerFailed =
        Math.random() * 100 < workerFailurePercent;

      if (workerFailed) {
        simulatedWorkerErrors.push({
          workerId: queue.workerId,
          message: "Simulated worker failure",
        });
      }

      for (const test of queue.tests) {
        const actualTime = Number(test.executionTime.toFixed(2));
        const startedAt = new Date(workerClock);
        const completedAt = new Date(
          workerClock + actualTime * 60_000
        );

        workerClock = completedAt.getTime();

        // A failed worker cannot execute its assigned tests.
        const executionStatus = workerFailed
          ? "ERROR"
          : simulateStatus();

        const executionId = randomUUID();
        let connection;

        try {
          connection = await pool.getConnection();
          await connection.beginTransaction();

          await connection.query(
            `INSERT INTO test_executions
              (execution_id, run_id, test_id, worker_id,
               execution_status, actual_time, started_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              executionId,
              runId,
              test.testId,
              queue.workerId,
              executionStatus,
              actualTime,
              startedAt,
              completedAt,
            ]
          );

          const failedIncrement =
            executionStatus === "FAILED" ? 1 : 0;

          await connection.query(
            `INSERT INTO test_history
              (test_id, total_executions, failure_count, last_execution)
             VALUES (?, 1, ?, ?)
             ON DUPLICATE KEY UPDATE
               total_executions = total_executions + 1,
               failure_count = failure_count + VALUES(failure_count),
               last_execution = VALUES(last_execution)`,
            [test.testId, failedIncrement, completedAt]
          );

          await connection.commit();

          executionResults.push({
            executionId,
            runId,
            testId: test.testId,
            workerId: queue.workerId,
            executionStatus,
            actualTime,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
          });
        } catch (error) {
          if (connection) {
            try {
              await connection.rollback();
            } catch (rollbackError) {
              console.error("Result rollback failed:", rollbackError);
            }
          }

          console.error(
            `Could not record result for ${test.testId}:`,
            error
          );

          workerFailures.push({
            testId: test.testId,
            workerId: queue.workerId,
            message: "Result could not be recorded",
          });

          // Stop this queue if its result could not be persisted.
          break;
        } finally {
          connection?.release();
        }
      }
    })
  );


  const finishConnection = await pool.getConnection();

  try {
    await finishConnection.beginTransaction();

    if (workerFailures.length > 0 || simulatedWorkerErrors.length > 0) {
      // ERROR is a run-level signal here; successfully committed results
      // remain persisted. This route does not fabricate results for
      // tests that could not be recorded.
      await finishConnection.query(
        `UPDATE optimization_runs SET status = 'ERROR' WHERE run_id = ?`,
        [runId]
      );
    } else {
      await finishConnection.query(
        `UPDATE optimization_runs SET status = 'COMPLETED' WHERE run_id = ?`,
        [runId]
      );
    }

    await finishConnection.commit();
  } catch (error) {
    await finishConnection.rollback();
    console.error("Could not finalize execution run:", error);

    return res.status(500).json({
      success: false,
      runId,
      strategy,
      plan,
      results: executionResults,
      message:
        "Some results may already be saved, but the run status could not be finalized. Check run history before retrying.",
    });
  } finally {
    finishConnection.release();
  }

  return res.status(workerFailures.length > 0 ? 500 : 200).json({
    success: workerFailures.length === 0,
    runId,
    strategy,
    plan,
    results: executionResults,
    workerFailures,
    simulatedWorkerErrors,
    message:
  workerFailures.length > 0 || simulatedWorkerErrors.length > 0
    ? "Execution encountered worker or result-recording errors. Check the returned results and run history."
    : "Simulated execution completed and results were saved.",
  });
});

export default router;
