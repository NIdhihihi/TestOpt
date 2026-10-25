import test from "node:test";
import assert from "node:assert/strict";
import { redisConnectionOptions } from "./redisConnection.js";

test("Redis URL preserves port, credentials, database and TLS", () => {
  assert.deepEqual(redisConnectionOptions("rediss://alice:p%40ss@redis.example:6380/2"), { host: "redis.example", port: 6380, username: "alice", password: "p@ss", db: 2, tls: {} });
  assert.throws(() => redisConnectionOptions("http://localhost"), /must use/);
  assert.throws(() => redisConnectionOptions("redis://localhost/not-a-db"), /non-negative integer/);
});
