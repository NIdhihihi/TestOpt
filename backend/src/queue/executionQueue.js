import { Queue } from "bullmq";
import { redisConnectionOptions } from "./redisConnection.js";

const connection = {
  ...redisConnectionOptions(),
  maxRetriesPerRequest: 1,
  commandTimeout: 3000,
  enableOfflineQueue: false,
  connectTimeout: 2000,
};
export let executionQueue;
function getExecutionQueue() {
  if (!executionQueue) {
    executionQueue = new Queue(process.env.EXECUTION_QUEUE_NAME || "testopt-execution", { connection });
    executionQueue.on("error", error => console.error("Execution queue error:", error.message));
  }
  return executionQueue;
}

import net from "node:net";

export async function isRedisAvailable(timeout = 500) {
  const { host, port } = redisConnectionOptions();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function enqueueExecution(payload) {
  const available = await isRedisAvailable();
  if (!available) {
    throw new Error("Redis is unreachable");
  }
  return getExecutionQueue().add("execute-run", payload, {
    jobId: payload.jobId,
    attempts: 1,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}
