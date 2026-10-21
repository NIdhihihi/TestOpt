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

function parseCsv(csvText) {
  if (typeof csvText !== "string" || csvText.length > 1024 * 1024) throw new Error("csvText must be a CSV file up to 1 MB.");
  const rows = [];
  let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === '"') { if (quoted && csvText[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && csvText[index + 1] === "\n") index += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const headers = rows.shift().map((header) => header.toLowerCase());
  if (!headers.includes("type")) throw new Error("CSV must include a type column.");
  return rows.map((values, index) => Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex] || ""]))).map((entry, index) => ({ ...entry, line: index + 2 }));
}

function csvValue(row, key, maxLength = 150) { return text(row[key], `${key} on line ${row.line}`, maxLength); }

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

router.post("/projects/:projectId/import", async (req, res) => {
  let connection;
  try {
    const { projectId } = req.params;
    await requireProjectRole(req.auth.sub, projectId, ["OWNER", "ADMIN", "TEST_MANAGER"]);
    if (!(await projectExists(projectId))) return res.status(404).json({ success: false, message: "Project was not found." });
    const rows = parseCsv(req.body.csvText);
    const modules = rows.filter((row) => row.type.toUpperCase() === "MODULE");
    const tests = rows.filter((row) => row.type.toUpperCase() === "TEST");
    const dependencies = rows.filter((row) => row.type.toUpperCase() === "DEPENDENCY");
    const coverage = rows.filter((row) => row.type.toUpperCase() === "COVERAGE");
    if (rows.length !== modules.length + tests.length + dependencies.length + coverage.length) throw new Error("type must be MODULE, TEST, DEPENDENCY, or COVERAGE.");
    const moduleIds = new Set(modules.map((row) => csvValue(row, "id", 50)));
    const testIds = new Set(tests.map((row) => csvValue(row, "id", 50)));
    if (moduleIds.size !== modules.length || testIds.size !== tests.length) throw new Error("Module and test IDs must be unique within the CSV.");
    for (const row of modules) { csvValue(row, "name"); numberInRange(row.criticality, `criticality on line ${row.line}`, 1, 10); }
    for (const row of tests) { csvValue(row, "name"); numberInRange(row.executiontime, `executionTime on line ${row.line}`, 0.01, 100000); if (!priorities.has(csvValue(row, "priority", 10).toUpperCase())) throw new Error(`Invalid priority on line ${row.line}.`); }
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [existingModules, existingTests] = await Promise.all([
      moduleIds.size ? connection.query("SELECT module_id FROM modules WHERE project_id = ? AND module_id IN (?)", [projectId, [...moduleIds]]) : [[]],
      testIds.size ? connection.query("SELECT test_id FROM test_cases WHERE project_id = ? AND test_id IN (?)", [projectId, [...testIds]]) : [[]],
    ]);
    if (existingModules[0].length || existingTests[0].length) throw new Error("CSV IDs already exist in this project. Use new IDs or edit the existing records.");
    for (const row of modules) await connection.query("INSERT INTO modules (module_id, project_id, module_name, criticality) VALUES (?, ?, ?, ?)", [row.id, projectId, row.name, Number(row.criticality)]);
    for (const row of tests) { await connection.query("INSERT INTO test_cases (test_id, project_id, test_name, execution_time, priority) VALUES (?, ?, ?, ?, ?)", [row.id, projectId, row.name, Number(row.executiontime), row.priority.toUpperCase()]); await connection.query("INSERT INTO test_history (test_id) VALUES (?)", [row.id]); }
    const knownModules = new Set([...moduleIds]); const knownTests = new Set([...testIds]);
    for (const row of dependencies) { const source = csvValue(row, "sourcemoduleid", 50); const target = csvValue(row, "targetmoduleid", 50); if (source === target || !knownModules.has(source) || !knownModules.has(target)) throw new Error(`Dependencies on line ${row.line} must reference imported module IDs.`); await connection.query("INSERT INTO module_dependencies (project_id, source_module_id, target_module_id) VALUES (?, ?, ?)", [projectId, source, target]); }
    for (const row of coverage) { const testId = csvValue(row, "testid", 50); const moduleId = csvValue(row, "moduleid", 50); if (!knownTests.has(testId) || !knownModules.has(moduleId)) throw new Error(`Coverage on line ${row.line} must reference imported IDs.`); await connection.query("INSERT INTO test_coverage (test_id, module_id, coverage_weight) VALUES (?, ?, ?)", [testId, moduleId, numberInRange(row.coverageweight, `coverageWeight on line ${row.line}`, 0, 1)]); }
    await connection.commit();
    return res.status(201).json({ success: true, imported: { modules: modules.length, tests: tests.length, dependencies: dependencies.length, coverage: coverage.length } });
  } catch (error) {
    if (connection) await connection.rollback();
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message || "CSV could not be imported." });
  } finally { if (connection) connection.release(); }
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
