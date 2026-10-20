import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://localhost:5000/api";
const PROJECT_ID = "P_TESTOPT";

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function App() {
  const [modules, setModules] = useState([]);
  const [availableWorkers, setAvailableWorkers] = useState([]);
  const [changedModuleIds, setChangedModuleIds] = useState([]);
  const [timeBudget, setTimeBudget] = useState(15);
  const [workerCount, setWorkerCount] = useState(2);
  const [algorithm, setAlgorithm] = useState("GREEDY");
  const [strategy, setStrategy] = useState("GREEDY");
  const [optimization, setOptimization] = useState(null);
  const [plan, setPlan] = useState(null);
  const [execution, setExecution] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadSetupData() {
    try {
      const [moduleResponse, workerResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/optimization/projects/${PROJECT_ID}/modules`),
        fetch(`${API_BASE_URL}/optimization/workers`),
      ]);
      const [moduleData, workerData] = await Promise.all([moduleResponse.json(), workerResponse.json()]);
      if (!moduleResponse.ok) throw new Error(moduleData.message);
      if (!workerResponse.ok) throw new Error(workerData.message);
      setError("");
      setModules(moduleData.modules);
      setAvailableWorkers(workerData.workers);
      setWorkerCount((current) => Math.min(Math.max(1, Number(current)), Math.max(1, workerData.workers.length)));
    } catch {
      setError("Could not load modules and workers. Start the backend at http://localhost:5000, then retry.");
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(loadSetupData, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const selectedModuleNames = useMemo(
    () => modules.filter((module) => changedModuleIds.includes(module.moduleId)).map((module) => module.moduleName),
    [modules, changedModuleIds],
  );

  function toggleModule(moduleId) {
    setChangedModuleIds((current) => current.includes(moduleId)
      ? current.filter((id) => id !== moduleId)
      : [...current, moduleId]);
  }

  async function request(path, body) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Request failed.");
    return data;
  }

  async function optimize(event) {
    event.preventDefault();
    if (changedModuleIds.length === 0) {
      setError("Choose at least one changed module.");
      return;
    }

    setLoading(true);
    setError("");
    setPlan(null);
    setExecution(null);
    try {
      const result = await request("/optimization/optimize", {
        projectId: PROJECT_ID,
        changedModuleIds,
        timeBudget: Number(timeBudget),
        workerCount: Number(workerCount),
        algorithm,
      });
      setOptimization(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function previewPlan() {
    setLoading(true);
    setError("");
    setExecution(null);
    try {
      setPlan(await request(`/execution/${optimization.runId}/plan`, { strategy }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function approveExecution() {
    setLoading(true);
    setError("");
    try {
      setExecution(await request(`/execution/${optimization.runId}`, {
        strategy,
        approved: true,
        approvalToken: plan.approvalToken,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">TEST EXECUTION INTELLIGENCE</p>
          <h1>TestOpt</h1>
          <p className="lede">Select the tests that matter, fit them to your budget, and schedule the run.</p>
        </div>
        <div className="status"><span />Backend-driven workflow</div>
      </header>

      {error && <div className="alert" role="alert">{error}<button className="retry" onClick={loadSetupData}>Retry connection</button></div>}

      <section className="panel form-panel">
        <div className="section-heading">
          <div><p className="eyebrow">01 / DEFINE CHANGE</p><h2>Optimization request</h2></div>
          {selectedModuleNames.length > 0 && <p className="selection-note">{selectedModuleNames.join(", ")}</p>}
        </div>
        <form onSubmit={optimize}>
          <fieldset>
            <legend>Changed modules</legend>
            <div className="module-grid">
              {modules.map((module) => (
                <label className={`module-option ${changedModuleIds.includes(module.moduleId) ? "selected" : ""}`} key={module.moduleId}>
                  <input type="checkbox" checked={changedModuleIds.includes(module.moduleId)} onChange={() => toggleModule(module.moduleId)} />
                  <span>{module.moduleName}</span><small>Criticality {module.criticality}/10</small>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="controls">
            <label>Time budget (minutes)<input type="number" min="1" step="1" value={timeBudget} onChange={(event) => setTimeBudget(event.target.value)} /></label>
            <label>Available workers<input type="number" min="1" max={Math.max(1, availableWorkers.length)} step="1" value={workerCount} onChange={(event) => setWorkerCount(event.target.value)} /><small>{availableWorkers.length} available now</small></label>
            <label>Selection algorithm<select value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}><option value="GREEDY">Greedy</option><option value="KNAPSACK">Knapsack DP</option></select></label>
            <button className="primary" disabled={loading}>{loading ? "Working…" : "Optimize tests"}</button>
          </div>
        </form>
      </section>

      {optimization && <section className="panel results-panel">
        <div className="section-heading"><div><p className="eyebrow">02 / SELECT TESTS</p><h2>Optimization results</h2></div><span className="run-id">{optimization.runId}</span></div>
        <div className="metric-grid">
          <div><span>Time selected</span><strong>{formatNumber(optimization.totalExecutionTime)} / {optimization.timeBudget} min</strong></div>
          <div><span>Total score</span><strong>{formatNumber(optimization.totalScore)}</strong></div>
          <div><span>Tests selected</span><strong>{optimization.selectedTests.length} of {optimization.candidatesConsidered}</strong></div>
          <div><span>Affected modules</span><strong>{optimization.affectedModuleIds.length}</strong></div>
        </div>
        <p className="affected"><b>Affected:</b> {optimization.affectedModuleIds.join(" · ")}</p>
        <div className="test-list">
          {optimization.selectedTests.map((test, index) => <article className="test-card" key={test.testId}><span className="rank">{index + 1}</span><div><h3>{test.testName}</h3><p>{test.testId} · {test.priority} priority · covers {test.coveredModuleIds.join(", ")}</p></div><strong>{test.executionTime} min</strong><span className="score">{formatNumber(test.score)} score</span></article>)}
        </div>
        <div className="execution-actions"><label>Scheduling strategy<select value={strategy} onChange={(event) => { setStrategy(event.target.value); setPlan(null); setExecution(null); }}><option value="GREEDY">Greedy load balancing</option><option value="FCFS">First come, first served</option><option value="PRIORITY">Priority first</option><option value="LPT">Longest processing time</option></select></label><button className="primary" onClick={previewPlan} disabled={loading}>{loading ? "Working…" : "Preview execution plan"}</button></div>
      </section>}

      {plan && <section className="panel"><div className="section-heading"><div><p className="eyebrow">03 / REVIEW PLAN</p><h2>Worker schedule</h2></div><span className="tag">{plan.schedulingStrategy}</span></div>
        <div className="schedule-grid">{plan.plan.workers.map((worker) => <article className="worker-card" key={worker.workerId}><div className="worker-top"><h3>{worker.workerId}</h3><span>{worker.estimatedLoad} min load</span></div>{worker.tests.map((test) => <div className="scheduled-test" key={test.testId}><b>{test.testId}</b><span>{test.startOffset}–{test.endOffset} min</span></div>)}</article>)}</div>
        <div className="execution-actions"><p>{plan.plan.metrics.totalTests} tests · {plan.plan.metrics.makespan} min makespan · {plan.plan.metrics.workerUtilization}% utilization</p><button className="primary" onClick={approveExecution} disabled={loading}>{loading ? "Working…" : "Approve & execute"}</button></div>
      </section>}

      {execution && <section className="panel"><div className="section-heading"><div><p className="eyebrow">04 / RESULTS</p><h2>Execution complete</h2></div><span className="tag success">{execution.results.length} saved results</span></div>
        <div className="test-list">{execution.results.map((result) => <article className="test-card" key={result.executionId}><span className={`result-dot ${result.executionStatus.toLowerCase()}`} /><div><h3>{result.testId}</h3><p>{result.workerId} · {result.actualTime} minutes</p></div><span className={`result-status ${result.executionStatus.toLowerCase()}`}>{result.executionStatus}</span></article>)}</div>
      </section>}
    </main>
  );
}

export default App;
