import "dotenv/config";
import { Worker } from "bullmq";
import pool from "./db/connection.js";
import { executeSourcePlan } from "./services/sourceExecution.js";
import { redisConnectionOptions } from "./queue/redisConnection.js";

const connection = { ...redisConnectionOptions(), maxRetriesPerRequest: null };


const worker = new Worker(process.env.EXECUTION_QUEUE_NAME || "testopt-execution", async (job) => {
  if (job.data.sourcePlanId) return executeSourcePlan(job.data.sourcePlanId);
  throw new Error("Legacy suite jobs cannot attribute individual test results. Use an uploaded-project plan.");
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 1) });

worker.on("completed", (job) => console.log(`Execution job ${job.id} completed`));
worker.on("failed", async (job, error) => {
  try {
    if (job?.data?.sourcePlanId) await pool.query("UPDATE source_plans SET status = 'ERROR', error_message = ? WHERE plan_id = ?", [error.message, job.data.sourcePlanId]);
    else if (job?.data?.jobId) {
      await pool.query("UPDATE execution_jobs SET queue_status = 'FAILED', error_message = ?, completed_at = NOW() WHERE job_id = ?", [error.message, job.data.jobId]);
      await pool.query("UPDATE optimization_runs SET status = 'ERROR' WHERE run_id = ? AND status IN ('EXECUTING', 'RUNNING')", [job.data.runId]);
    }
  } catch (recordError) { console.error("Could not persist worker failure:", recordError.message); }
  console.error("Execution worker job failed:", error.message);
});

process.on("SIGTERM", async () => { await worker.close(); await pool.end(); });
