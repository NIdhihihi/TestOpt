
import { Router } from "express";
import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectRole } from "../middleware/authorization.js";
import { recordAuditEvent } from "../services/auditService.js";
import { createSchedule } from "./scheduler.js";
import { RUN_STATES, TEST_STATES, validateRunTransition, transitionRunState, transitionTestState } from "./stateMachine.js";

const router = Router();
const VALID_STRATEGIES = new Set(["FCFS", "PRIORITY", "GREEDY", "LPT"]);
// Temporarily remember plans that the developer has reviewed.
const approvedPlans = new Map();

router.use(requireAuth);

router.get("/projects/:projectId/runs", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId);
    const [runs] = await pool.query(
      `SELECT r.run_id AS runId, r.selection_algorithm AS selectionAlgorithm, r.scheduling_strategy AS schedulingStrategy,
              r.time_budget AS timeBudget, r.worker_count AS workerCount, r.status, r.created_at AS createdAt,
              COUNT(st.test_id) AS selectedTestCount
       FROM optimization_runs r LEFT JOIN selected_tests st ON st.run_id = r.run_id
       WHERE r.project_id = ? GROUP BY r.run_id ORDER BY r.created_at DESC LIMIT 25`,
      [req.params.projectId],
    );
    return res.json({ success: true, runs });
  } catch (error) { return res.status(error.statusCode ?? 500).json({ success: false, message: error.message || "Run history could not be retrieved." }); }
});

router.get("/projects/:projectId/analytics", async (req, res) => {
  try {
    const projectId = req.params.projectId;
    await requireProjectRole(req.auth.sub, projectId);
    const [[summary], [savings], trend] = await Promise.all([
      pool.query(
        `SELECT COUNT(te.execution_id) AS executionCount,
                COALESCE(SUM(te.execution_status = 'PASSED'), 0) AS passedCount,
                COALESCE(SUM(te.execution_status = 'FAILED'), 0) AS failedCount,
                COALESCE(SUM(te.execution_status = 'ERROR'), 0) AS errorCount,
                COALESCE(AVG(te.actual_time), 0) AS averageDuration
         FROM test_executions te JOIN optimization_runs r ON r.run_id = te.run_id
         WHERE r.project_id = ?`, [projectId],
      ).then(([rows]) => rows),
      pool.query(
        `SELECT COALESCE(SUM(GREATEST(0, all_tests.totalTime - selected_tests.selectedTime)), 0) AS minutesSaved
         FROM optimization_runs r
         JOIN (SELECT project_id, SUM(execution_time) AS totalTime FROM test_cases WHERE status = 'ACTIVE' GROUP BY project_id) all_tests ON all_tests.project_id = r.project_id
         LEFT JOIN (SELECT st.run_id, SUM(tc.execution_time) AS selectedTime FROM selected_tests st JOIN test_cases tc ON tc.test_id = st.test_id GROUP BY st.run_id) selected_tests ON selected_tests.run_id = r.run_id
         WHERE r.project_id = ?`, [projectId],
      ).then(([rows]) => rows),
      pool.query(
        `SELECT DATE_FORMAT(te.completed_at, '%Y-%m-%d') AS day,
                SUM(te.execution_status = 'PASSED') AS passed,
                SUM(te.execution_status = 'FAILED') AS failed,
                SUM(te.execution_status = 'ERROR') AS errors
         FROM test_executions te JOIN optimization_runs r ON r.run_id = te.run_id
         WHERE r.project_id = ? AND te.completed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY day ORDER BY day`, [projectId],
      ).then(([rows]) => rows),
    ]);
    const total = Number(summary.executionCount);
    return res.json({ success: true, summary: { executionCount: total, passedCount: Number(summary.passedCount), failedCount: Number(summary.failedCount), errorCount: Number(summary.errorCount), passRate: total ? Number(((Number(summary.passedCount) / total) * 100).toFixed(1)) : 0, averageDuration: Number(Number(summary.averageDuration).toFixed(2)), minutesSaved: Number(Number(savings.minutesSaved).toFixed(2)) }, trend });
  } catch (error) { return res.status(error.statusCode ?? 500).json({ success: false, message: error.message || "Analytics could not be retrieved." }); }
});

router.post("/:runId/queue", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT project_id FROM optimization_runs WHERE run_id = ?", [req.params.runId]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "Run was not found." });
    await requireProjectRole(req.auth.sub, rows[0].project_id);
    return res.status(422).json({ success: false, message: "Upload the project to execute independently attributed test files. Manual catalog plans support explicitly labeled simulation; a suite exit code cannot establish individual test results." });
  } catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
});

router.get("/:runId/results", async (req, res) => {
  try {
    const [runs] = await pool.query("SELECT project_id AS projectId, status FROM optimization_runs WHERE run_id = ?", [req.params.runId]);
    if (!runs[0]) return res.status(404).json({ success: false, message: "Run was not found." });
    await requireProjectRole(req.auth.sub, runs[0].projectId);
    const [results] = await pool.query("SELECT execution_id AS executionId, test_id AS testId, worker_id AS workerId, execution_status AS executionStatus, actual_time AS actualTime FROM test_executions WHERE run_id = ? ORDER BY completed_at, test_id", [req.params.runId]);
    const [jobs] = await pool.query("SELECT queue_status AS status, error_message AS message FROM execution_jobs WHERE run_id = ? ORDER BY queued_at DESC LIMIT 1", [req.params.runId]);
    return res.json({ success: true, runId: req.params.runId, status: runs[0].status, results, job: jobs[0] || null });
  } catch (error) { return res.status(error.statusCode ?? 500).json({ success: false, message: error.message }); }
});

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
    `SELECT run_id, project_id, selection_algorithm AS selectionAlgorithm,
            scheduling_strategy AS schedulingStrategy, worker_count AS workerCount, status
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
     ORDER BY st.selection_rank, st.test_id`,
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
     ORDER BY worker_id
     LIMIT ?`,
    [runs[0].workerCount]
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
      await connection.beginTransaction();
      await connection.query("SELECT status FROM optimization_runs WHERE run_id = ? FOR UPDATE", [req.params.runId]);
      const { run, plan } = await getPlan(
        connection,
        req.params.runId,
        strategy
      );
      const projectAccess = await requireProjectRole(req.auth.sub, run.project_id);

      if (!["SELECTED", "PLAN_READY", "PLAN_REJECTED"].includes(run.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot preview execution for a run that is ${run.status}`,
        });
      }
      await transitionRunState(connection, req.params.runId, RUN_STATES.PLAN_READY);
      const [selected] = await connection.query("SELECT test_id FROM selected_tests WHERE run_id = ?", [req.params.runId]);
      for (const test of selected) await transitionTestState(connection, req.params.runId, test.test_id, TEST_STATES.ASSIGNED);
      await connection.commit();
      const approvalToken = randomUUID();

      approvedPlans.set(approvalToken, {
        runId: req.params.runId,
        selectionAlgorithm: run.selectionAlgorithm,
        schedulingStrategy: strategy,
        strategy,
        signature: JSON.stringify(plan),
        expiresAt: Date.now() + 10 * 60 * 1000, // expires in 10 minutes
      });
      await recordAuditEvent({ organizationId: projectAccess.organizationId, userId: req.auth.sub, eventType: "EXECUTION_PLAN_PREVIEWED", resourceType: "optimization_run", resourceId: req.params.runId, details: { strategy } });

      return res.json({
        success: true,
        approved: false,
        approvalToken,
        runId: req.params.runId,
        selectionAlgorithm: run.selectionAlgorithm,
        schedulingStrategy: strategy,
        strategy,
        plan,
        message: "Review this plan before approving execution.",
      });
    } finally {
      await connection.rollback();
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
      `SELECT run_id, project_id, selection_algorithm AS selectionAlgorithm,
              scheduling_strategy AS schedulingStrategy, worker_count AS workerCount, status
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
    await requireProjectRole(req.auth.sub, runs[0].project_id);

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
       ORDER BY st.selection_rank, st.test_id`,
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
       ORDER BY worker_id
       LIMIT ?`,
      [runs[0].workerCount]
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

    // Multi-strategy comparative analysis (SRS REQ-4.8.5, REQ-4.10.3)
    const bestMakespan = Math.min(
      ...comparisons.map((item) => item.metrics.makespan)
    );
    const bestUtilization = Math.max(
      ...comparisons.map((item) => item.metrics.workerUtilization)
    );
    const bestImbalance = Math.min(
      ...comparisons.map((item) => item.metrics.imbalance)
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
      bestUtilizationStrategies: comparisons
        .filter((item) => item.metrics.workerUtilization === bestUtilization)
        .map((item) => item.strategy),
      bestImbalanceStrategies: comparisons
        .filter((item) => item.metrics.imbalance === bestImbalance)
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
      `SELECT run_id, project_id, worker_count AS workerCount, status
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
    const projectAccess = await requireProjectRole(req.auth.sub, runs[0].project_id);
    const [activeProject] = await startConnection.query("SELECT archived_at FROM projects WHERE project_id = ?", [runs[0].project_id]);
    if (activeProject[0]?.archived_at) { await startConnection.rollback(); return res.status(409).json({ success: false, message: "Project is archived." }); }

    if (["RUNNING", "EXECUTING", "COMPLETED"].includes(runs[0].status)) {
      await startConnection.rollback();
      return res.status(409).json({
        success: false,
        message: `Run ${runId} is already ${runs[0].status}`,
      });
    }

    const [queued] = await startConnection.query("SELECT job_id FROM execution_jobs WHERE run_id = ? AND queue_status IN ('QUEUED', 'PROCESSING')", [runId]);
    if (queued.length) {
      await startConnection.rollback();
      return res.status(409).json({ success: false, message: "This run has a queued execution." });
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
       ORDER BY st.selection_rank, st.test_id`,
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
       LIMIT ?
       FOR UPDATE`,
      [runs[0].workerCount]
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

    validateRunTransition(runs[0].status, RUN_STATES.EXECUTING);

    await startConnection.query(
      `UPDATE optimization_runs
       SET status = 'EXECUTING', scheduling_strategy = ?
       WHERE run_id = ?`,
      [strategy, runId]
    );

    for (const test of tests) await transitionTestState(startConnection, runId, test.testId, TEST_STATES.RUNNING);

    await startConnection.commit();
    await recordAuditEvent({ organizationId: projectAccess.organizationId, userId: req.auth.sub, eventType: "EXECUTION_STARTED", resourceType: "optimization_run", resourceId: runId, details: { strategy } });
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

          await transitionTestState(connection, runId, test.testId, executionStatus);
          await transitionTestState(connection, runId, test.testId, TEST_STATES.RECORDED);

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
      await transitionRunState(finishConnection, runId, RUN_STATES.ERROR);
    } else {
      await transitionRunState(finishConnection, runId, RUN_STATES.COMPLETED);
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

router.post("/:runId/reject", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { runId } = req.params;
    const [runs] = await connection.query(
      "SELECT run_id AS runId, project_id AS projectId, status FROM optimization_runs WHERE run_id = ? FOR UPDATE",
      [runId]
    );
    if (!runs[0]) {
      return res.status(404).json({ success: false, message: `Optimization run ${runId} was not found.` });
    }
    const run = runs[0];
    const projectAccess = await requireProjectRole(req.auth.sub, run.projectId, ["OWNER", "ADMIN", "TEST_MANAGER", "DEVELOPER"]);

    // Validate state transition using stateMachine.js
    validateRunTransition(run.status, RUN_STATES.PLAN_REJECTED);

    const [jobs] = await connection.query("SELECT job_id FROM execution_jobs WHERE run_id = ? AND queue_status IN ('QUEUED', 'PROCESSING')", [runId]);
    if (jobs.length) return res.status(409).json({ success: false, message: "Cannot reject a queued execution." });

    // Invalidate approval token if any
    for (const [token, data] of approvedPlans.entries()) {
      if (data.runId === runId) {
        approvedPlans.delete(token);
      }
    }

    await connection.query(
      "UPDATE optimization_runs SET status = ? WHERE run_id = ?",
      [RUN_STATES.PLAN_REJECTED, runId]
    );

    await connection.commit();

    await recordAuditEvent({
      organizationId: projectAccess.organizationId,
      userId: req.auth.sub,
      eventType: "PLAN_REJECTED",
      resourceType: "optimization_run",
      resourceId: runId,
      details: { reason: req.body?.reason || "Explicitly rejected by user" },
    });

    return res.json({
      success: true,
      runId,
      status: RUN_STATES.PLAN_REJECTED,
      message: "Optimization plan has been explicitly rejected.",
    });
  } catch (error) {
    await connection.rollback();
    return res.status(error.statusCode ?? 500).json({ success: false, message: error.message });
  } finally {
    await connection.rollback();
    connection.release();
  }
});

router.get("/:runId/export", async (req, res) => {
  try {
    const { runId } = req.params;
    const [runs] = await pool.query(
      `SELECT r.run_id AS runId, r.project_id AS projectId, p.project_name AS projectName,
              r.selection_algorithm AS selectionAlgorithm, r.scheduling_strategy AS schedulingStrategy,
              r.time_budget AS timeBudget, r.worker_count AS workerCount, r.status,
              r.created_at AS createdAt,
              c.change_id AS changeId, c.description AS changeDescription
       FROM optimization_runs r
       JOIN projects p ON p.project_id = r.project_id
       LEFT JOIN code_changes c ON c.change_id = r.change_id
       WHERE r.run_id = ?`,
      [runId]
    );

    if (!runs[0]) {
      return res.status(404).json({ success: false, message: `Optimization run ${runId} was not found.` });
    }
    const run = runs[0];
    await requireProjectRole(req.auth.sub, run.projectId);

    const [testRows] = await pool.query(
      `SELECT st.test_id AS testId, tc.test_name AS testName, tc.priority,
              tc.execution_time AS executionTime, st.score, st.selection_rank AS selectionRank,
              st.selection_reason AS selectionReason, st.status AS testStatus,
              te.worker_id AS workerId, te.actual_time AS actualTime,
              te.execution_status AS executionStatus, te.started_at AS startedAt, te.completed_at AS completedAt
       FROM selected_tests st
       JOIN test_cases tc ON tc.test_id = st.test_id
       LEFT JOIN test_executions te ON te.run_id = st.run_id AND te.test_id = st.test_id
       WHERE st.run_id = ?
       ORDER BY st.selection_rank ASC`,
      [runId]
    );

    function escapeCsv(field) {
      if (field === null || field === undefined) return "";
      const raw = String(field);
      const stringValue = typeof field === "string" && /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n") || stringValue.includes("\r")) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }

    const csvLines = [];
    csvLines.push("=== TESTOPT OPTIMIZATION RUN REPORT ===");
    csvLines.push(`Run ID,${escapeCsv(run.runId)}`);
    csvLines.push(`Project ID,${escapeCsv(run.projectId)}`);
    csvLines.push(`Project Name,${escapeCsv(run.projectName)}`);
    csvLines.push(`Status,${escapeCsv(run.status)}`);
    csvLines.push(`Selection Algorithm,${escapeCsv(run.selectionAlgorithm)}`);
    csvLines.push(`Scheduling Strategy,${escapeCsv(run.schedulingStrategy || "N/A")}`);
    csvLines.push(`Time Budget (min),${escapeCsv(run.timeBudget)}`);
    csvLines.push(`Worker Count,${escapeCsv(run.workerCount)}`);
    csvLines.push(`Created At,${escapeCsv(run.createdAt)}`);
    if (run.changeDescription) {
      csvLines.push(`Change Description,${escapeCsv(run.changeDescription)}`);
    }
    csvLines.push("");
    csvLines.push("=== TEST DISTRIBUTION & EXECUTION SCHEDULE ===");
    csvLines.push("Note,Worker assignments and durations below are recorded execution results; preview assignments are not persisted. Project runner outcomes apply to the configured suite command.");
    csvLines.push([
      "Rank",
      "Test ID",
      "Test Name",
      "Priority",
      "Execution Time (min)",
      "Score",
      "Assigned Worker",
      "Test Status",
      "Execution Status",
      "Actual Duration (min)",
      "Selection Reason",
    ].map(escapeCsv).join(","));

    for (const test of testRows) {
      csvLines.push([
        test.selectionRank,
        test.testId,
        test.testName,
        test.priority,
        test.executionTime,
        Number(test.score).toFixed(4),
        test.workerId || (test.executionStatus ? "Project runner" : "Unassigned"),
        test.testStatus,
        test.executionStatus || "N/A",
        test.actualTime !== null ? Number(test.actualTime).toFixed(2) : "N/A",
        test.selectionReason || "",
      ].map(escapeCsv).join(","));
    }

    const csvContent = csvLines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="optimization-report-${runId}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    return res.status(error.statusCode ?? 500).json({ success: false, message: error.message });
  }
});

export default router;
