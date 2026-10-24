import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const driver = fileURLToPath(new URL('./source-driver.cjs', import.meta.url));
export function sourceResultStatus(plan, results) {
  if (results.some(result => result.status === 'ERROR')) return 'ERROR';
  if (results.some(result => result.status === 'FAILED')) return 'FAILED';
  return plan.complete && results.length === plan.selectedTests.length && results.every(result => result.status === 'PASSED' && result.coverageAvailable) ? 'COMPLETED' : 'INCOMPLETE';
}

function command(args, timeout = 20000) {
  return new Promise(resolve => {
    const child = spawn('docker', args, { windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, output, timedOut: true }); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { output = (output + chunk).slice(-1024 * 1024); });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, output: error.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

export async function runSourceFile(directory, testPath) {
  const name = `testopt-file-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  try {
    const result = await command(['run', '--rm', '--pull=never', '--name', name,
      '--network', 'none', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--user', '65534:65534',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
      '--mount', `type=bind,source=${directory},target=/project,readonly`,
      '--mount', `type=bind,source=${driver},target=/driver.cjs,readonly`,
      '--workdir', '/project', 'node:24-alpine', 'node', '/driver.cjs', `./${testPath}`]);
    if (result.code !== 0) return { testPath, status: 'ERROR', startedAt, completedAt: new Date().toISOString(), actualTime: 0, covered: [], coverageAvailable: false, output: result.output.slice(-6000), message: result.timedOut ? 'Container deadline exceeded.' : 'Container could not execute. Ensure Docker and the node:24-alpine image are available.' };
    const report = JSON.parse(result.output.trim().split(/\r?\n/).at(-1));
    if (!['PASSED', 'FAILED', 'ERROR', 'NOT_RUN'].includes(report.status)) throw new Error('Invalid runner report.');
    return { ...report, testPath, startedAt, completedAt: new Date().toISOString() };
  } catch (error) {
    return { testPath, status: 'ERROR', startedAt, completedAt: new Date().toISOString(), actualTime: 0, covered: [], coverageAvailable: false, message: error.message };
  } finally { await command(['rm', '--force', name], 5000); }
}

export async function withSourceDirectory(files, action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testopt-source-'));
  try {
    for (const file of files) {
      const destination = path.join(directory, ...file.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.content, { mode: 0o444 });
    }
    return await action(directory);
  } finally {
    // directory is created directly by mkdtemp above and never derived from user paths.
    await fs.rm(directory, { recursive: true, force: true });
  }
}
