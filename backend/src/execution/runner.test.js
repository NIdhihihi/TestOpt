import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "./runner.js";

const options = { workspacePath: ".", commandName: process.execPath };
test("runner distinguishes command failure from infrastructure error", async () => {
  const success = await runCommand({ ...options, commandArgs: ["-e", "process.exit(0)"], timeoutMs: 10000 });
  assert.equal(success.code, 0);
  assert.equal(success.isError, false);
  const failed = await runCommand({ ...options, commandArgs: ["-e", "process.exit(1)"], timeoutMs: 10000 });
  assert.equal(failed.code, 1);
  assert.equal(failed.isError, false);
});
test("runner terminates a hanging process at its deadline", async () => {
  const started = Date.now();
  const result = await runCommand({ ...options, commandArgs: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.isError, true);
  assert.ok(Date.now() - started < 10000);
});
test("runner rejects paths outside the workspace", () => {
  assert.throws(() => runCommand({ ...options, workspacePath: "../../..", commandArgs: [] }), /must stay inside/);
});

test("timeout terminates descendants as well as the runner", async () => {
  const script = `const {spawn} = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'}); console.log(child.pid); setInterval(() => {}, 1000);`;
  const result = await runCommand({ ...options, commandArgs: ["-e", script], timeoutMs: 2000 });
  assert.equal(result.timedOut, true);
  const pid = Number(result.output.split(/\r?\n/)[0]);
  assert.ok(Number.isInteger(pid) && pid > 0, "child process must start before timeout");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
