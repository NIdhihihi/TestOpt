import "dotenv/config";
import { Worker } from "bullmq";
import pool from "./db/connection.js";

const connection = { url: process.env.REDIS_URL || "redis://127.0.0.1:6379", maxRetriesPerRequest: null };

const worker = new Worker("testopt-execution", async (job) => {
  const { jobId, runId } = job.data;
  await pool.query("UPDATE execution_jobs SET queue_status = 'PROCESSING', attempt_count = attempt_count + 1, started_at = NOW() WHERE job_id = ?", [jobId]);
  // The next adapter slice executes the configured test runner here and writes test_executions.
  // This worker owns the durable job lifecycle; the API never waits for test execution.
  await pool.query("UPDATE execution_jobs SET queue_status = 'SUCCEEDED', completed_at = NOW() WHERE job_id = ?", [jobId]);
  return { runId, jobId, message: "Job lifecycle completed; configure a runner adapter to execute tests." };
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 4) });

worker.on("completed", (job) => console.log(`Execution job ${job.id} completed`));
worker.on("failed", async (job, error) => {
  if (job?.data?.jobId) await pool.query("UPDATE execution_jobs SET queue_status = 'FAILED', error_message = ?, completed_at = NOW() WHERE job_id = ?", [error.message, job.data.jobId]);
  console.error("Execution worker job failed:", error.message);
});

process.on("SIGTERM", async () => { await worker.close(); await pool.end(); });
