import "dotenv/config";
import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import pool from "./db/connection.js";

const connection = { url: process.env.REDIS_URL || "redis://127.0.0.1:6379", maxRetriesPerRequest: null };

function runCommand({ workspacePath, commandName, commandArgs }) {
  const root = path.resolve(process.env.TEST_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
  const workspace = path.resolve(root, workspacePath);
  if (!workspace.startsWith(`${root}${path.sep}`) && workspace !== root) throw new Error("Runner workspace must stay inside TEST_WORKSPACE_ROOT.");
  const command = process.platform === "win32" && commandName === "npm" ? "npm.cmd" : commandName;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: workspace, shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output: output.slice(-4000) }));
  });
}

const worker = new Worker("testopt-execution", async (job) => {
  const { jobId, runId } = job.data;
  await pool.query("UPDATE execution_jobs SET queue_status = 'PROCESSING', attempt_count = attempt_count + 1, started_at = NOW() WHERE job_id = ?", [jobId]);
  const [configs] = await pool.query("SELECT r.project_id AS projectId, c.workspace_path AS workspacePath, c.command_name AS commandName, c.command_args AS commandArgs FROM optimization_runs r LEFT JOIN project_runner_configs c ON c.project_id = r.project_id WHERE r.run_id = ?", [runId]);
  if (!configs[0]?.commandName) throw new Error("No test runner is configured for this project.");
  const [selectedTests] = await pool.query("SELECT test_id AS testId FROM selected_tests WHERE run_id = ? ORDER BY selection_rank", [runId]);
  if (!selectedTests.length) throw new Error("This run has no selected tests.");
  const started = Date.now();
  const result = await runCommand({ ...configs[0], commandArgs: typeof configs[0].commandArgs === "string" ? JSON.parse(configs[0].commandArgs) : configs[0].commandArgs });
  const actualTime = Number((((Date.now() - started) / 1000) / 60).toFixed(2));
  const executionStatus = result.code === 0 ? "PASSED" : "FAILED";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const test of selectedTests) {
      await connection.query("INSERT INTO test_executions (execution_id, run_id, test_id, execution_status, actual_time, started_at, completed_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", [randomUUID(), runId, test.testId, executionStatus, actualTime]);
      await connection.query("UPDATE test_history SET total_executions = total_executions + 1, failure_count = failure_count + ?, last_execution = NOW() WHERE test_id = ?", [executionStatus === "FAILED" ? 1 : 0, test.testId]);
    }
    await connection.query("UPDATE optimization_runs SET status = ? WHERE run_id = ?", [executionStatus === "PASSED" ? "COMPLETED" : "ERROR", runId]);
    await connection.query("UPDATE execution_jobs SET queue_status = ?, completed_at = NOW(), error_message = ? WHERE job_id = ?", [executionStatus === "PASSED" ? "SUCCEEDED" : "FAILED", result.output || null, jobId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (executionStatus !== "PASSED") throw new Error("The configured test command failed.");
  return { runId, jobId, executionStatus };
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 4) });

worker.on("completed", (job) => console.log(`Execution job ${job.id} completed`));
worker.on("failed", async (job, error) => {
  if (job?.data?.jobId) await pool.query("UPDATE execution_jobs SET queue_status = 'FAILED', error_message = ?, completed_at = NOW() WHERE job_id = ?", [error.message, job.data.jobId]);
  console.error("Execution worker job failed:", error.message);
});

process.on("SIGTERM", async () => { await worker.close(); await pool.end(); });
