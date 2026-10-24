import { useEffect, useState } from 'react';

export default function SourceWorkspace({ request, projects, projectId, selectProject, organizationId, created }) {
  const [name, setName] = useState('');
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState('');
  const [plans, setPlans] = useState([]);
  const [currentId, setCurrentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [budget, setBudget] = useState('15');
  const [workers, setWorkers] = useState('2');
  const [algorithm, setAlgorithm] = useState('AUTO');
  const archived = Boolean(projects.find(item => item.projectId === projectId)?.archivedAt);
  const version = versions.find(item => item.versionId === versionId);
  const current = plans.find(item => item.planId === currentId);
  const executing = plans.some(item => ['QUEUED', 'EXECUTING'].includes(item.status));
  const base = `/source/projects/${projectId}`;

  async function refresh() {
    if (!projectId) return;
    const [versionData, planData] = await Promise.all([request(`${base}/versions`), request(`${base}/plans`)]);
    setVersions(versionData.versions); setPlans(planData.plans);
    setVersionId(value => value || versionData.versions[0]?.versionId || '');
    setCurrentId(value => value || planData.plans[0]?.planId || '');
    if (planData.plans[0]) { setBudget(String(planData.plans[0].plan.timeBudget)); setWorkers(String(planData.plans[0].plan.workerCount)); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => refresh().catch(reason => setError(reason.message)), 0);
    return () => window.clearTimeout(timer);
    // Component is remounted for each project; request contains the current authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!executing) return undefined;
    const timer = window.setInterval(() => {
      request(`${base}/plans`).then(async data => { setPlans(data.plans); if (!data.plans.some(item => ['QUEUED','EXECUTING'].includes(item.status))) { const updated = await request(`${base}/versions`); setVersions(updated.versions); } }).catch(reason => setError(reason.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [executing, base, request]);

  async function createProject(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request('/catalog/projects', 'POST', { projectName: name, organizationId }); await created(result.project.projectId); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!projectId || !files.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const accepted = files.filter(file => {
        const relative = file.webkitRelativePath || file.name;
        return !relative.split('/').some(part => /^(node_modules|\.git|\.env(?:\..*)?|dist|build|coverage|\.ssh|\.aws)$/i.test(part)) && /\.(js|mjs|cjs|json|md|txt|ts|tsx|jsx)$/.test(file.name);
      });
      if (!accepted.length || accepted.length > 300 || accepted.some(file => file.size > 512 * 1024) || accepted.reduce((sum, file) => sum + file.size, 0) > 5 * 1024 * 1024) throw new Error('Choose 1–300 text source files; limit 512 KB per file and 5 MB total.');
      const payload = await Promise.all(accepted.map(async file => ({ path: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name, content: await file.text() })));
      const result = await request(`${base}/versions`, 'POST', { files: payload });
      setVersionId(result.versionId); setCurrentId('');
      await refresh(); setCurrentId('');
      setNotice(`Version uploaded and inspected. ${files.length - accepted.length} excluded dependency, build, secret, or non-text files were not uploaded. No project code has run.`);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(`${base}/versions/${versionId}/plan`, 'POST', { timeBudget: Number(budget), workerCount: Number(workers), algorithm });
      setPlans(items => [{ ...result, versionId, status: 'PLANNED', results: [] }, ...items]); setCurrentId(result.planId);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true); setError('');
    try { await request(`${base}/plans/${currentId}/approve`, 'POST', { approved: true }); await refresh(); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true); setError('');
    try { await request(`${base}/plans/${currentId}/reject`, 'POST', {}); await refresh(); setCurrentId(''); setNotice('Plan rejected without execution. Adjust advanced preferences and prepare another plan.'); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function download() {
    try {
      const data = await request(`${base}/plans/${currentId}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `testopt-${currentId}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason.message); }
  }
  async function archive() {
    if (!window.confirm('Archive this project? Its versions, plans, and execution history will remain stored.')) return;
    setBusy(true); setError('');
    try { await request(`/catalog/projects/${projectId}`, 'DELETE'); await created(''); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }

  return <section className="source-workspace">
    <section className="panel">
      <p className="eyebrow">UPLOAD → ANALYZE → REVIEW → EXECUTE</p>
      <h2>Let TestOpt prepare the test plan</h2>
      <p>Upload your project once, then upload a new version after changing code. TestOpt discovers dependencies, identifies changed files, and explains which tests to run.</p>
      <p className="affected">First supported adapter: dependency-free JavaScript using node:test. Each test file is executed independently in a restricted container. Other frameworks can use the manual catalog below.</p>
      {archived && <p className="notice">Archived project: history remains available; new uploads and executions are disabled.</p>}
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="source-controls">
        <label>Source project<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">Choose or create a project</option>{projects.map(project => <option key={project.projectId} value={project.projectId}>{project.projectName}{project.archivedAt ? " (archived)" : ""}</option>)}</select></label>
        <form onSubmit={createProject}><label>New source project<input required value={name} onChange={event => setName(event.target.value)} placeholder="My application" /></label><button className="secondary" disabled={busy}>Create project</button></form>
        <label>Upload project folder<input type="file" multiple webkitdirectory="" directory="" onChange={upload} disabled={!projectId || archived || busy || executing} /></label>
      </div>
      {projectId && !archived && <button className="secondary" disabled={busy || executing} onClick={archive}>Archive project and preserve history</button>}
    </section>
    {versions.length > 0 && <section className="panel">
      <div className="section-heading"><h2>Discovered project</h2><span className="tag">{version?.analysis.supported ? 'node:test' : 'Needs another adapter'}</span></div>
      <label>Project version<select value={versionId} onChange={event => { setVersionId(event.target.value); setCurrentId(''); }}>{versions.map(item => <option key={item.versionId} value={item.versionId}>{new Date(item.createdAt).toLocaleString()} · {item.baselineReady ? 'Baseline ready' : 'Awaiting validation'}</option>)}</select></label>
      {version && <>
        <p>{version.analysis.modules.length} source modules · {version.analysis.tests.length} test files · {version.analysis.dependencies.length} discovered dependencies</p>
        <div className="source-change-grid">{['added', 'modified', 'deleted'].map(kind => <div key={kind}><strong>{kind}</strong><ul>{version.analysis.changes[kind].map(name => <li key={name}>{name}</li>)}</ul>{!version.analysis.changes[kind].length && <p>None</p>}</div>)}</div>
        {version.analysis.assumptions?.map(message => <p className="affected" key={message}>{message}</p>)}
        {[...version.analysis.unsupported, ...version.analysis.warnings].map(message => <p className="notice" key={message}>{message}</p>)}
        <details><summary>Review detected dependencies and test files</summary><ul>{version.analysis.dependencies.map(edge => <li key={`${edge.source}:${edge.target}`}>{edge.source} depends on {edge.target}</li>)}</ul><ul>{version.analysis.tests.map(name => <li key={name}>{name}</li>)}</ul></details>
        <details className="source-advanced"><summary>Advanced preferences</summary><div className="source-controls"><label>Testing budget (minutes)<input type="number" min="0.001" step="0.001" max="1440" value={budget} onChange={event => setBudget(event.target.value)} /></label><label>Isolated workers<input type="number" min="1" max="4" value={workers} onChange={event => setWorkers(event.target.value)} /></label><label>Selection policy<select value={algorithm} onChange={event => setAlgorithm(event.target.value)}><option value="AUTO">Automatic (recommended)</option><option value="GREEDY">Greedy: overlapping coverage</option><option value="KNAPSACK">DP: fixed additive values</option><option value="BRANCH_AND_BOUND">Branch and Bound: bounded fixed-value search</option></select></label></div></details>
        <p>Saved plan preferences: {budget} minutes · {workers} workers · {algorithm}. TestOpt chooses the algorithm automatically by default.</p>
        <button className="primary" disabled={busy || executing || archived || !version.analysis.supported} onClick={prepare}>Analyze changes and prepare plan</button>
      </>}
    </section>}
    {current && <section className="panel">
      <div className="section-heading"><h2>Review test plan</h2><span className="tag">{current.status}</span></div>
      <p><strong>{current.plan.algorithm}</strong> · {current.plan.algorithmReason} Selection took {current.plan.selectionRunningTimeMs} ms.</p>
      {current.plan.search && <p>Branch and Bound: {current.plan.search.provenOptimal ? 'Search completed; optimal for fixed additive values.' : 'Search capped; best-found result.'}</p>}
      <p>{current.plan.selectedTests.length} selected / {current.plan.requiredTests.length} relevant / {version?.analysis.tests.length ?? '—'} total test files.</p>
      <p className="affected">{current.plan.notice}</p>
      {current.plan.fallbackReasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
      {current.plan.budgetConflict && <div className="alert">Incomplete validation: the budget excludes relevant checks. Increase the budget or explicitly run this partial plan; passing it will still be reported as incomplete.</div>}
      {current.plan.coverageGap?.length > 0 && <div className="alert">Incomplete validation: no test evidence covers {current.plan.coverageGap.join(', ')}. Add or review tests before treating this change as validated.</div>}
      {current.plan.noChanges && <p>No files changed since the previous version.</p>}
      <div className="schedule-grid">{current.plan.schedule?.workers.map(worker => <article className="worker-card" key={worker.workerId}><h3>{worker.workerId}</h3><p>{worker.estimatedLoad} estimated minutes</p>{worker.tests.map(test => <p key={test.testId}><strong>{test.testId}</strong><br />{current.plan.selectedTests.find(item => item.testId === test.testId)?.reason}</p>)}</article>)}</div>
      <details><summary>Skipped files and baseline comparisons</summary><ul>{current.plan.skippedTests.map(name => <li key={name}>{name}</li>)}</ul><div className="table-responsive"><table className="comparison-table"><thead><tr><th>Strategy</th><th>Files</th><th>Estimated minutes</th><th>Fixed-value score</th><th>Modules</th><th>Makespan (min)</th><th>Utilization</th><th>Imbalance (min)</th></tr></thead><tbody>{Object.entries(current.plan.comparisons).map(([key, value]) => <tr key={key}><td>{key === 'runAll' ? 'Run all relevant candidates' : key}</td><td>{value.testCount}</td><td>{value.estimatedMinutes}</td><td>{value.staticValue}</td><td>{value.coveredModuleCount}</td><td>{value.makespan}</td><td>{value.workerUtilization}%</td><td>{value.imbalance}</td></tr>)}</tbody></table></div><p>Run-all is unconstrained and may exceed the budget. Fixed-value scores compare the same coefficients; they do not prove optimality for overlap-aware selection.</p></details>
      {current.status === 'PLANNED' && <div className="execution-actions"><button className="primary" disabled={busy || executing || archived || !current.plan.selectedTests.length} onClick={approve}>Approve and run selected test files</button><button className="secondary" onClick={reject} disabled={busy}>Reject and retune</button></div>}
      {['QUEUED', 'EXECUTING'].includes(current.status) && <p role="status">{current.status === 'QUEUED' ? 'Waiting for an execution worker…' : 'Assigned test files are running in isolated containers…'}</p>}
      {current.message && <p className="alert">{current.message}</p>}
      {current.results.length > 0 && <><h3>Actual test-file results</h3>{current.results.map(result => <article className="source-result" key={result.testPath}><strong>{result.testPath}</strong><span>{result.status} · {result.workerId} · {Number(result.actualTime).toFixed(3)} minutes</span><details><summary>Output and coverage evidence</summary><pre>{result.output || result.message}</pre><p>{result.assertionCount ?? 0} assertions; {result.coverageAvailable ? 'coverage collected' : 'coverage unavailable'}.</p></details></article>)}</>}
      <button className="secondary" onClick={download}>Download plan and results</button>
    </section>}
    {plans.length > 0 && <section className="panel"><h2>Source run history</h2><div className="run-history">{plans.map(item => <article key={item.planId}><div><strong>{item.plan.algorithm}</strong><span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Just prepared'} · {item.status}</span></div><button className="secondary" onClick={() => { setCurrentId(item.planId); setVersionId(item.versionId); }}>Open plan and results</button></article>)}</div></section>}
  </section>;
}
