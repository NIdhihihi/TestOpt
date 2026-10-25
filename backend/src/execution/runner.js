import { spawn } from "node:child_process";
import path from "node:path";

export function runCommand({ workspacePath, commandName, commandArgs, timeoutMs = Number(process.env.TEST_RUNNER_TIMEOUT_MS || 180000) }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Runner timeout must be positive.");
  const root = path.resolve(process.env.TEST_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
  const workspace = path.resolve(root, workspacePath);
  if (!workspace.startsWith(`${root}${path.sep}`) && workspace !== root) throw new Error("Runner workspace must stay inside TEST_WORKSPACE_ROOT.");
  const command = process.platform === "win32" && commandName === "npm" ? "npm.cmd" : commandName;
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(command, commandArgs, { cwd: workspace, shell: process.platform === "win32" && commandName === "npm", windowsHide: true, detached: process.platform !== "win32" });
    let output = "";
    let forceTimer;
    let closed = false;
    function terminate(signal) {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        const fallback = () => { try { child.kill(); } catch {} };
        killer.on("error", fallback);
        killer.on("exit", code => { if (code !== 0) fallback(); });
      } else {
        try { process.kill(-child.pid, signal); } catch {}
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceTimer = setTimeout(() => { if (!closed) terminate("SIGKILL"); }, 2000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      closed = true;
      resolve({ code: -1, output: output + `\nRunner error: ${err.message}`, timedOut: false, isError: true });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      closed = true;
      const isTimeout = timedOut || signal === "SIGTERM" || signal === "SIGKILL";
      resolve({
        code: code ?? -1,
        output: isTimeout ? `${output}\nExecution timed out after ${timeoutMs}ms.` : output.slice(-4000),
        timedOut: isTimeout,
        isError: isTimeout || signal !== null || code === null || code === -1,
      });
    });
  });
}
