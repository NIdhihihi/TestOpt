import { Queue } from "bullmq";

const connection = { url: process.env.REDIS_URL || "redis://127.0.0.1:6379", maxRetriesPerRequest: null };
export const executionQueue = new Queue("testopt-execution", { connection });

export async function enqueueExecution(payload) {
  return executionQueue.add("execute-run", payload, {
    jobId: payload.jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}
