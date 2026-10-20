import { Router } from "express";
import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";
import {
  buildCandidates,
  findAffectedModuleIds,
  selectGreedy,
  selectKnapsack,
  summarizeSelection,
} from "../services/optimizationService.js";

const router = Router();

function validateRequest(body) {
  const { projectId, changedModuleIds, timeBudget, workerCount, algorithm = "GREEDY" } = body;

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return "projectId must be a non-empty string.";
  }
  if (!Array.isArray(changedModuleIds) || changedModuleIds.length === 0 || !changedModuleIds.every((id) => typeof id === "string" && id.trim() !== "")) {
    return "changedModuleIds must be a non-empty array of module IDs.";
  }
  if (new Set(changedModuleIds).size !== changedModuleIds.length) {
    return "changedModuleIds must not contain duplicates.";
  }
  if (!Number.isFinite(timeBudget) || timeBudget <= 0) {
    return "timeBudget must be a number greater than 0.";
  }
  if (!Number.isInteger(workerCount) || workerCount <= 0) {
    return "workerCount must be a positive integer.";
  }
  if (!["GREEDY", "KNAPSACK"].includes(algorithm)) {
    return "algorithm must be GREEDY or KNAPSACK.";
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
  } = req.body;
  const connection = await pool.getConnection();

  try {
    const [modules, dependencies, tests, coverage, history] = await Promise.all([
      connection.query("SELECT module_id, module_name, criticality FROM modules WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT source_module_id, target_module_id FROM module_dependencies WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT test_id, test_name, execution_time, priority, status FROM test_cases WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT tc.test_id, tc.module_id, tc.coverage_weight FROM test_coverage tc JOIN modules m ON m.module_id = tc.module_id WHERE m.project_id = ?", [projectId]).then(([rows]) => rows),
      connection.query("SELECT th.test_id, th.total_executions, th.failure_count, th.last_execution FROM test_history th JOIN test_cases tc ON tc.test_id = th.test_id WHERE tc.project_id = ?", [projectId]).then(([rows]) => rows),
    ]);

    if (modules.length === 0) {
      return res.status(404).json({ success: false, message: "Project was not found or has no modules." });
    }

    const moduleIds = new Set(modules.map((module) => module.module_id));
    const unknownModuleIds = changedModuleIds.filter((moduleId) => !moduleIds.has(moduleId));
    if (unknownModuleIds.length > 0) {
      return res.status(400).json({ success: false, message: "Some changedModuleIds do not belong to this project.", unknownModuleIds });
    }

    const affectedModuleIds = findAffectedModuleIds(changedModuleIds, dependencies);
    const candidates = buildCandidates({ tests, coverage, history, modules, affectedModuleIds });
    const selectedTests = algorithm === "KNAPSACK"
      ? selectKnapsack(candidates, timeBudget)
      : selectGreedy(candidates, timeBudget);
    const runId = `RUN_${randomUUID()}`;
    const changeId = `CHG_${randomUUID()}`;

    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO code_changes (change_id, project_id, time_budget) VALUES (?, ?, ?)",
      [changeId, projectId, timeBudget],
    );
    await connection.query(
      "INSERT INTO code_change_modules (change_id, module_id) VALUES ?",
      [changedModuleIds.map((moduleId) => [changeId, moduleId])],
    );
    await connection.query(
      "INSERT INTO optimization_runs (run_id, project_id, change_id, selection_algorithm, time_budget, worker_count, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [runId, projectId, changeId, algorithm, timeBudget, workerCount, "SELECTED"],
    );
    if (selectedTests.length > 0) {
      await connection.query(
        "INSERT INTO selected_tests (run_id, test_id, score, selection_rank, selection_reason) VALUES ?",
        [selectedTests.map((test, index) => [runId, test.testId, test.score, index + 1, test.reason])],
      );
    }
    await connection.commit();

    return res.status(201).json({
      success: true,
      runId,
      projectId,
      selectionAlgorithm: algorithm,
      changedModuleIds,
      affectedModuleIds,
      workerCount,
      timeBudget,
      candidatesConsidered: candidates.length,
      selectedTests,
      ...summarizeSelection(selectedTests),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Optimization failed:", error.message);
    return res.status(500).json({ success: false, message: "Optimization could not be completed." });
  } finally {
    connection.release();
  }
});

export default router;
