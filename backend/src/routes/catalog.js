import { Router } from "express";
import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrganizationRole, requireProjectRole } from "../middleware/authorization.js";

const router = Router();
const priorities = new Set(["HIGH", "MEDIUM", "LOW"]);
const workerStatuses = new Set(["AVAILABLE", "BUSY", "UNAVAILABLE"]);

router.use(requireAuth);

function text(value, name, maxLength = 150) {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > maxLength) {
    throw new Error(`${name} must be a non-empty value up to ${maxLength} characters.`);
  }
  return value.trim();
}

function numberInRange(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function runnerConfig(body) {
  const workspacePath = text(body.workspacePath, "workspacePath", 255);
  if (workspacePath.includes("..") || workspacePath.startsWith("/") || workspacePath.startsWith("\\")) throw new Error("workspacePath must be a relative folder inside the configured workspace root.");
  if (body.commandName !== "npm") throw new Error("Only the npm runner is currently supported.");
  if (!Array.isArray(body.commandArgs) || body.commandArgs.length === 0 || !body.commandArgs.every((arg) => typeof arg === "string" && /^[a-zA-Z0-9_./:@=-]+$/.test(arg))) throw new Error("commandArgs must be a non-empty list of safe npm arguments.");
  return { workspacePath, commandName: "npm", commandArgs: body.commandArgs };
}

function generatedId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

async function projectExists(projectId) {
  const [projects] = await pool.query("SELECT project_id FROM projects WHERE project_id = ?", [projectId]);
  return projects.length > 0;
}

router.get("/projects", async (req, res) => {
  try {
    const [projects] = await pool.query(
      "SELECT p.project_id AS projectId, p.project_name AS projectName, p.description, p.organization_id AS organizationId FROM projects p JOIN organization_members om ON om.organization_id = p.organization_id WHERE om.user_id = ? ORDER BY p.project_name",
      [req.auth.sub],
    );
    return res.json({ success: true, projects });
  } catch (error) {
    console.error("Project retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Projects could not be retrieved." });
  }
});

router.get("/projects/:projectId", async (req, res) => {
  try {
    const projectId = req.params.projectId;
    await requireProjectRole(req.auth.sub, projectId);
    const [projects, modules, dependencies, tests, coverage] = await Promise.all([
      pool.query("SELECT project_id AS projectId, project_name AS projectName, description FROM projects WHERE project_id = ?", [projectId]).then(([rows]) => rows),
      pool.query("SELECT module_id AS moduleId, module_name AS moduleName, criticality FROM modules WHERE project_id = ? ORDER BY module_name", [projectId]).then(([rows]) => rows),
      pool.query("SELECT source_module_id AS sourceModuleId, target_module_id AS targetModuleId FROM module_dependencies WHERE project_id = ? ORDER BY source_module_id, target_module_id", [projectId]).then(([rows]) => rows),
      pool.query("SELECT test_id AS testId, test_name AS testName, execution_time AS executionTime, priority, status FROM test_cases WHERE project_id = ? ORDER BY test_name", [projectId]).then(([rows]) => rows),
      pool.query("SELECT tc.test_id AS testId, tc.module_id AS moduleId, tc.coverage_weight AS coverageWeight FROM test_coverage tc JOIN test_cases t ON t.test_id = tc.test_id WHERE t.project_id = ? ORDER BY tc.test_id, tc.module_id", [projectId]).then(([rows]) => rows),
    ]);
    if (projects.length === 0) return res.status(404).json({ success: false, message: "Project was not found." });
    return res.json({ success: true, project: projects[0], modules, dependencies, tests, coverage });
  } catch (error) {
    console.error("Project catalog retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Project data could not be retrieved." });
  }
});

router.get("/projects/:projectId/runner", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId);
    const [configs] = await pool.query("SELECT runner_type AS runnerType, workspace_path AS workspacePath, command_name AS commandName, command_args AS commandArgs FROM project_runner_configs WHERE project_id = ?", [req.params.projectId]);
    return res.json({ success: true, runnerConfig: configs[0] || null });
  } catch (error) { return res.status(error.statusCode ?? 500).json({ success: false, message: error.message }); }
});

router.put("/projects/:projectId/runner", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    const config = runnerConfig(req.body);
    await pool.query("INSERT INTO project_runner_configs (project_id, runner_type, workspace_path, command_name, command_args) VALUES (?, 'NPM', ?, ?, ?) ON DUPLICATE KEY UPDATE workspace_path = VALUES(workspace_path), command_name = VALUES(command_name), command_args = VALUES(command_args)", [req.params.projectId, config.workspacePath, config.commandName, JSON.stringify(config.commandArgs)]);
    return res.json({ success: true, runnerConfig: { runnerType: "NPM", ...config } });
  } catch (error) { return res.status(error.statusCode ?? 400).json({ success: false, message: error.message }); }
});

router.get("/workers", async (_req, res) => {
  try {
    const [workers] = await pool.query("SELECT worker_id AS workerId, worker_status AS workerStatus FROM workers ORDER BY worker_id");
    return res.json({ success: true, workers });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Workers could not be retrieved." });
  }
});

router.post("/projects", async (req, res) => {
  try {
    const projectName = text(req.body.projectName, "projectName");
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    const organizationId = text(req.body.organizationId, "organizationId", 50);
    await requireOrganizationRole(req.auth.sub, organizationId);
    const [organizations] = await pool.query("SELECT organization_id FROM organizations WHERE organization_id = ?", [organizationId]);
    if (!organizations.length) return res.status(404).json({ success: false, message: "Organization was not found." });
    const projectId = generatedId("P");
    await pool.query("INSERT INTO projects (project_id, organization_id, project_name, description) VALUES (?, ?, ?, ?)", [projectId, organizationId, projectName, description || null]);
    return res.status(201).json({ success: true, project: { projectId, organizationId, projectName, description } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Project could not be created." });
  }
});

router.put("/projects/:projectId/modules/:moduleId", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    const moduleName = text(req.body.moduleName, "moduleName");
    const criticality = numberInRange(req.body.criticality, "criticality", 1, 10);
    const [result] = await pool.query("UPDATE modules SET module_name = ?, criticality = ? WHERE project_id = ? AND module_id = ?", [moduleName, criticality, req.params.projectId, req.params.moduleId]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Module was not found in this project." });
    return res.json({ success: true, module: { moduleId: req.params.moduleId, moduleName, criticality } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/projects/:projectId/modules", async (req, res) => {
  try {
    const projectId = req.params.projectId;
    await requireProjectRole(req.auth.sub, projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    if (!(await projectExists(projectId))) return res.status(404).json({ success: false, message: "Project was not found." });
    const moduleName = text(req.body.moduleName, "moduleName");
    const criticality = numberInRange(req.body.criticality, "criticality", 1, 10);
    const moduleId = generatedId("M");
    await pool.query("INSERT INTO modules (module_id, project_id, module_name, criticality) VALUES (?, ?, ?, ?)", [moduleId, projectId, moduleName, criticality]);
    return res.status(201).json({ success: true, module: { moduleId, moduleName, criticality } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Module could not be created." });
  }
});

router.post("/projects/:projectId/dependencies", async (req, res) => {
  try {
    const { projectId } = req.params;
    await requireProjectRole(req.auth.sub, projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    const sourceModuleId = text(req.body.sourceModuleId, "sourceModuleId", 50);
    const targetModuleId = text(req.body.targetModuleId, "targetModuleId", 50);
    if (sourceModuleId === targetModuleId) throw new Error("A module cannot depend on itself.");
    const [modules] = await pool.query("SELECT module_id FROM modules WHERE project_id = ? AND module_id IN (?, ?)", [projectId, sourceModuleId, targetModuleId]);
    if (modules.length !== 2) throw new Error("Both modules must belong to this project.");
    await pool.query("INSERT INTO module_dependencies (project_id, source_module_id, target_module_id) VALUES (?, ?, ?)", [projectId, sourceModuleId, targetModuleId]);
    return res.status(201).json({ success: true, dependency: { sourceModuleId, targetModuleId } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.code === "ER_DUP_ENTRY" ? "This dependency already exists." : error.message });
  }
});

router.post("/projects/:projectId/tests", async (req, res) => {
  try {
    const projectId = req.params.projectId;
    await requireProjectRole(req.auth.sub, projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    if (!(await projectExists(projectId))) return res.status(404).json({ success: false, message: "Project was not found." });
    const testName = text(req.body.testName, "testName");
    const executionTime = numberInRange(req.body.executionTime, "executionTime", 0.01, 100000);
    const priority = text(req.body.priority, "priority", 10).toUpperCase();
    if (!priorities.has(priority)) throw new Error("priority must be HIGH, MEDIUM, or LOW.");
    const testId = generatedId("T");
    await pool.query("INSERT INTO test_cases (test_id, project_id, test_name, execution_time, priority) VALUES (?, ?, ?, ?, ?)", [testId, projectId, testName, executionTime, priority]);
    await pool.query("INSERT INTO test_history (test_id) VALUES (?)", [testId]);
    return res.status(201).json({ success: true, test: { testId, testName, executionTime, priority, status: "ACTIVE" } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Test could not be created." });
  }
});

router.put("/projects/:projectId/tests/:testId", async (req, res) => {
  try {
    await requireProjectRole(req.auth.sub, req.params.projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    const testName = text(req.body.testName, "testName");
    const executionTime = numberInRange(req.body.executionTime, "executionTime", 0.01, 100000);
    const priority = text(req.body.priority, "priority", 10).toUpperCase();
    const status = text(req.body.status, "status", 10).toUpperCase();
    if (!priorities.has(priority) || !["ACTIVE", "INACTIVE"].includes(status)) throw new Error("Use a valid priority and status.");
    const [result] = await pool.query("UPDATE test_cases SET test_name = ?, execution_time = ?, priority = ?, status = ? WHERE project_id = ? AND test_id = ?", [testName, executionTime, priority, status, req.params.projectId, req.params.testId]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Test was not found in this project." });
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.put("/projects/:projectId/coverage", async (req, res) => {
  try {
    const { projectId } = req.params;
    await requireProjectRole(req.auth.sub, projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    const testId = text(req.body.testId, "testId", 50);
    const moduleId = text(req.body.moduleId, "moduleId", 50);
    const coverageWeight = numberInRange(req.body.coverageWeight, "coverageWeight", 0, 1);
    const [testRows, moduleRows] = await Promise.all([
      pool.query("SELECT test_id FROM test_cases WHERE project_id = ? AND test_id = ?", [projectId, testId]).then(([rows]) => rows),
      pool.query("SELECT module_id FROM modules WHERE project_id = ? AND module_id = ?", [projectId, moduleId]).then(([rows]) => rows),
    ]);
    if (!testRows.length || !moduleRows.length) throw new Error("The test and module must belong to this project.");
    await pool.query("INSERT INTO test_coverage (test_id, module_id, coverage_weight) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE coverage_weight = VALUES(coverage_weight)", [testId, moduleId, coverageWeight]);
    return res.json({ success: true, coverage: { testId, moduleId, coverageWeight } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/workers", async (req, res) => {
  try {
    const workerStatus = (req.body.workerStatus || "AVAILABLE").toUpperCase();
    if (!workerStatuses.has(workerStatus)) throw new Error("Use AVAILABLE, BUSY, or UNAVAILABLE for workerStatus.");
    const workerId = generatedId("W");
    await pool.query("INSERT INTO workers (worker_id, worker_status) VALUES (?, ?)", [workerId, workerStatus]);
    return res.status(201).json({ success: true, worker: { workerId, workerStatus } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.put("/workers/:workerId", async (req, res) => {
  try {
    const workerStatus = text(req.body.workerStatus, "workerStatus", 20).toUpperCase();
    if (!workerStatuses.has(workerStatus)) throw new Error("Use AVAILABLE, BUSY, or UNAVAILABLE for workerStatus.");
    const [result] = await pool.query("UPDATE workers SET worker_status = ? WHERE worker_id = ?", [workerStatus, req.params.workerId]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Worker was not found." });
    return res.json({ success: true, worker: { workerId: req.params.workerId, workerStatus } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
