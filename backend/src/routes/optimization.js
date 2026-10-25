import { Router } from "express";
import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectRole } from "../middleware/authorization.js";
import { recordAuditEvent } from "../services/auditService.js";
import {
  buildCandidates,
  checkChangedModulesCoverage,
  findAffectedModuleIds,
  selectBranchAndBound,
  selectGreedy,
  selectKnapsack,
  summarizeSelection,
} from "../services/optimizationService.js";
import { RUN_STATES, TEST_STATES } from "../execution/stateMachine.js";

const router = Router();

router.use(requireAuth);

router.get("/projects/:projectId/modules", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId);
    const [modules] = await pool.query(
      "SELECT module_id AS moduleId, module_name AS moduleName, criticality FROM modules WHERE project_id = ? ORDER BY module_name",
      [req.params.projectId],
    );

    return res.json({ success: true, modules });
  } catch (error) {
    console.error("Module retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Modules could not be retrieved." });
  }
});

router.get("/workers", async (req, res) => {
  try {
    const [workers] = await pool.query(
      "SELECT worker_id AS workerId, worker_status AS workerStatus FROM workers WHERE worker_status = 'AVAILABLE' ORDER BY worker_id",
    );
    return res.json({ success: true, workers });
  } catch (error) {
    console.error("Worker retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Workers could not be retrieved." });
  }
});

function validateRequest(body) {
  const { projectId, changedModuleIds, timeBudget, workerCount, algorithm = "GREEDY", description } = body;

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return "projectId must be a non-empty string.";
  }
  if (!Array.isArray(changedModuleIds) || changedModuleIds.length === 0 || !changedModuleIds.every((id) => typeof id === "string" && id.trim() !== "")) {
    return "changedModuleIds must be a non-empty array of module IDs.";
  }
  if (new Set(changedModuleIds).size !== changedModuleIds.length) {
    return "changedModuleIds must not contain duplicates.";
  }
  if (timeBudget !== undefined && (!Number.isFinite(timeBudget) || timeBudget <= 0)) {
    return "timeBudget must be a number greater than 0.";
  }
  if (workerCount !== undefined && (!Number.isInteger(workerCount) || workerCount <= 0)) {
    return "workerCount must be a positive integer.";
  }
  if (!["GREEDY", "KNAPSACK", "BRANCH_AND_BOUND"].includes(algorithm)) {
    return "algorithm must be GREEDY, KNAPSACK, or BRANCH_AND_BOUND.";
  }
  if (description !== undefined && typeof description !== "string") {
    return "description must be a string.";
  }

  return null;
}

router.post("/optimize", async (req, res) => {
  const validationError = validateRequest(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const {
    projectId,
    changedModuleIds,
    timeBudget,
    workerCount,
    algorithm = "GREEDY",
    description,
  } = req.body;
  let projectAccess;
  try {
    projectAccess = await requireProjectRole(req.auth.sub, projectId);
  } catch (error) {
    return res.status(error.statusCode ?? 403).json({ success: false, message: error.message });
  }
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [active] = await connection.query("SELECT project_id FROM projects WHERE project_id = ? AND archived_at IS NULL FOR UPDATE", [projectId]);
    if (!active.length) return res.status(409).json({ success: false, message: "Archived projects cannot start new runs." });
    const [modules, dependencies, tests, coverage, history, availableWorkers, constraints] = await Promise.all([
      connection.query("SELECT module_id, module_name, criticality FROM modules WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT source_module_id, target_module_id FROM module_dependencies WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT test_id, test_name, execution_time, priority, status FROM test_cases WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT tc.test_id, tc.module_id, tc.coverage_weight FROM test_coverage tc JOIN modules m ON m.module_id = tc.module_id WHERE m.project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT th.test_id, th.total_executions, th.failure_count, th.last_execution FROM test_history th JOIN test_cases tc ON tc.test_id = th.test_id WHERE tc.project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT worker_id FROM workers WHERE worker_status = 'AVAILABLE'").then(([rows]) => rows),
      connection.query("SELECT w1, w2, w3, w4, default_budget, max_workers FROM testing_constraints WHERE project_id = ?", [projectId]).then(([rows]) => rows[0] || null),
    ]);

    if (modules.length === 0) {
      return res.status(404).json({ success: false, message: "Project was not found or has no modules." });
    }

    const effectiveTimeBudget = timeBudget !== undefined ? Number(timeBudget) : (constraints?.default_budget ? Number(constraints.default_budget) : 15);
    const effectiveWorkerCount = workerCount !== undefined ? Number(workerCount) : (constraints?.max_workers ? Number(constraints.max_workers) : 2);
    const effectiveWeights = constraints
      ? { w1: Number(constraints.w1), w2: Number(constraints.w2), w3: Number(constraints.w3), w4: Number(constraints.w4) }
      : undefined;

    if (constraints && effectiveWorkerCount > Number(constraints.max_workers)) {
      return res.status(400).json({ success: false, message: `Project permits at most ${constraints.max_workers} workers.` });
    }
    if (effectiveWorkerCount > availableWorkers.length) {
      return res.status(400).json({
        success: false,
        message: `Only ${availableWorkers.length} worker(s) are currently available. Choose that number or fewer.`,
      });
    }

    const moduleIds = new Set(modules.map((module) => module.module_id));
    const unknownModuleIds = changedModuleIds.filter((moduleId) => !moduleIds.has(moduleId));
    if (unknownModuleIds.length > 0) {
      return res.status(400).json({ success: false, message: "Some changedModuleIds do not belong to this project.", unknownModuleIds });
    }

    const affectedModuleIds = findAffectedModuleIds(changedModuleIds, dependencies);
    const candidates = buildCandidates({
      tests,
      coverage,
      history,
      modules,
      affectedModuleIds,
      changedModuleIds,
      ...(effectiveWeights ? { weights: effectiveWeights } : {}),
    });

    const runId = `RUN_${randomUUID()}`;
    const changeId = `CHG_${randomUUID()}`;

    // REQ-4.5.8: If no candidate tests, transition to NO_TESTS_REQUIRED and finish
    if (candidates.length === 0) {

      await connection.query(
        "INSERT INTO code_changes (change_id, project_id, description, changed_module_ids, time_budget) VALUES (?, ?, ?, ?, ?)",
        [changeId, projectId, description || null, JSON.stringify(changedModuleIds), effectiveTimeBudget],
      );
      await connection.query(
        "INSERT INTO code_change_modules (change_id, module_id) VALUES ?",
        [changedModuleIds.map((moduleId) => [changeId, moduleId])],
      );
      await connection.query(
        "INSERT INTO optimization_runs (run_id, project_id, change_id, selection_algorithm, time_budget, worker_count, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [runId, projectId, changeId, algorithm, effectiveTimeBudget, effectiveWorkerCount, "NO_TESTS_REQUIRED"],
      );
      await connection.commit();

      return res.status(200).json({
        success: true,
        status: "NO_TESTS_REQUIRED",
        message: "No regression tests are required for the specified changed modules.",
        runId,
        projectId,
        selectionAlgorithm: algorithm,
        changedModuleIds,
        affectedModuleIds,
        workerCount: effectiveWorkerCount,
        timeBudget: effectiveTimeBudget,
        candidatesConsidered: 0,
        selectedTests: [],
        totalExecutionTime: 0,
        totalScore: 0,
      });
    }

    let selectedTests;
    if (algorithm === "KNAPSACK") {
      selectedTests = selectKnapsack(candidates, effectiveTimeBudget);
    } else if (algorithm === "BRANCH_AND_BOUND") {
      selectedTests = selectBranchAndBound(candidates, effectiveTimeBudget);
    } else {
      selectedTests = selectGreedy(candidates, effectiveTimeBudget);
    }

    // Check coverage of directly changed modules (SRS §5.2)
    const coverageReport = checkChangedModulesCoverage(selectedTests, changedModuleIds);
    const warnings = [];
    if (!coverageReport.allCovered) {
      warnings.push(`Budget of ${effectiveTimeBudget} minutes is too small to cover all directly changed modules (${coverageReport.uncoveredChanged.join(", ")}).`);
    }


    await connection.query(
      "INSERT INTO code_changes (change_id, project_id, description, changed_module_ids, time_budget) VALUES (?, ?, ?, ?, ?)",
      [changeId, projectId, description || null, JSON.stringify(changedModuleIds), effectiveTimeBudget],
    );
    await connection.query(
      "INSERT INTO code_change_modules (change_id, module_id) VALUES ?",
      [changedModuleIds.map((moduleId) => [changeId, moduleId])],
    );
    await connection.query(
      "INSERT INTO optimization_runs (run_id, project_id, change_id, selection_algorithm, time_budget, worker_count, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [runId, projectId, changeId, algorithm, effectiveTimeBudget, effectiveWorkerCount, RUN_STATES.PLAN_READY],
    );
    if (selectedTests.length > 0) {
      await connection.query(
        "INSERT INTO selected_tests (run_id, test_id, score, selection_rank, selection_reason, status) VALUES ?",
        [selectedTests.map((test, index) => [runId, test.testId, test.score, index + 1, test.reason, TEST_STATES.SELECTED])],
      );
    }
    await connection.commit();
    await recordAuditEvent({ organizationId: projectAccess.organizationId, userId: req.auth.sub, eventType: "OPTIMIZATION_CREATED", resourceType: "optimization_run", resourceId: runId, details: { projectId, algorithm, changedModuleIds, timeBudget: effectiveTimeBudget, workerCount: effectiveWorkerCount } });

    return res.status(201).json({
      success: true,
      runId,
      projectId,
      status: RUN_STATES.PLAN_READY,
      selectionAlgorithm: algorithm,
      changedModuleIds,
      affectedModuleIds,
      workerCount: effectiveWorkerCount,
      timeBudget: effectiveTimeBudget,
      candidatesConsidered: candidates.length,
      selectedTests,
      warnings: warnings.length > 0 ? warnings : undefined,
      ...summarizeSelection(selectedTests),
    });
  } catch (error) {
    await connection.rollback();
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error("Optimization failed:", error.message);
    return res.status(500).json({ success: false, message: "Optimization could not be completed." });
  } finally {
    await connection.rollback();
    connection.release();
  }
});

export default router;
