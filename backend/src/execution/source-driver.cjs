// Trusted harness mounted separately from uploaded source; all uploaded code runs in a child.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
fs.mkdirSync('/tmp/v8', { recursive: true });
const started = Date.now();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', process.argv[2]], {
  cwd: '/project', env: { PATH: process.env.PATH, NODE_V8_COVERAGE: '/tmp/v8' },
  encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024,
});
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const count = Number(output.match(/^# tests (\d+)$/m)?.[1] || 0);
const skipped = Number(output.match(/^# skipped (\d+)$/m)?.[1] || 0) + Number(output.match(/^# todo (\d+)$/m)?.[1] || 0);
const covered = new Set();
let coverageAvailable = false;
for (const name of fs.readdirSync('/tmp/v8').slice(0, 30)) {
  const filename = `/tmp/v8/${name}`;
  if (fs.statSync(filename).size > 4 * 1024 * 1024) continue;
  try {
    const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
    coverageAvailable = true;
    for (const script of report.result || []) if (script.url.startsWith('file:///project/') && script.functions?.some(fn => fn.ranges?.some(range => range.count > 0))) covered.add(decodeURIComponent(script.url.slice('file:///project/'.length)));
  } catch { /* Missing coverage is disclosed by coverageAvailable. */ }
}
const status = result.error || result.signal ? 'ERROR' : result.status !== 0 ? 'FAILED' : !count || skipped ? 'NOT_RUN' : 'PASSED';
console.log(JSON.stringify({ status, assertionCount: count, skipped, actualTime: Math.max(0.001, (Date.now() - started) / 60000), covered: [...covered], coverageAvailable: coverageAvailable && covered.has(process.argv[2].replace(/^\.\//, '')), output: output.slice(-6000), error: result.error?.message || null }));
