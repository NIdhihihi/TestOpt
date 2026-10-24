import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PAGES, STAGES, buildWorkspaceModel, initialVersion, readProjectUpload, formatDuration } from './workspaceModel.js';
import { Logo, Navigation, Dashboard, Suite, History } from './WorkspaceViews.jsx';
import './App.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const AnimatedScene = lazy(() => import('./VisualScene.jsx'));
const ManualWorkspace = lazy(() => import('./LegacyWorkspace.jsx'));
function VisualScene(props) { return <Suspense fallback={<div className="scene" aria-hidden="true" />}><AnimatedScene {...props} /></Suspense>; }
function LegacyWorkspace() { return <Suspense fallback={<p role="status">Loading manual tools…</p>}><ManualWorkspace /></Suspense>; }
const pageFromHash = () => PAGES.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', organizationName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'login' ? { email: form.email, password: form.password } : form) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Could not sign in.');
      onAuthenticated({ ...data, organizations: data.organizations || [data.organization] });
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  return <><VisualScene /><main className="auth-shell"><section className="card auth-card"><Logo /><span className="eyebrow">TEST EXECUTION INTELLIGENCE</span><h1>Make every test count.</h1><p>Understand your changes. Run the tests that matter.</p><div className="seg">{[['login', 'Sign in'], ['register', 'Create organization']].map(([key, text]) => <button key={key} className={mode === key ? 'on' : ''} onClick={() => setMode(key)}>{text}</button>)}</div>{error && <p className="alert" role="alert">{error}</p>}<form onSubmit={submit}>{(mode === 'register' ? ['name', 'organizationName', 'email', 'password'] : ['email', 'password']).map(key => <label key={key}>{({ name: 'Name', organizationName: 'Organization', email: 'Email', password: 'Password' })[key]}<input type={key === 'password' ? 'password' : key === 'email' ? 'email' : 'text'} required minLength={key === 'password' ? 12 : undefined} autoComplete={key === 'password' ? mode === 'login' ? 'current-password' : 'new-password' : key === 'email' ? 'email' : undefined} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}<button className="run" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button></form></section></main></>;
}

export default function App() {
  const [session, setSession] = useState(() => { try { return JSON.parse(localStorage.getItem('testopt-session')); } catch { return null; } });
  const [page, setPage] = useState(pageFromHash);
  const [projects, setProjects] = useState([]), [projectId, setProjectId] = useState('');
  const [versions, setVersions] = useState([]), [versionId, setVersionId] = useState('');
  const [plans, setPlans] = useState([]), [currentId, setCurrentId] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [setup, setSetup] = useState(''), [newName, setNewName] = useState('');
  const [budget, setBudget] = useState(15), [workers, setWorkers] = useState(2), [algorithm, setAlgorithm] = useState('AUTO');
  const [testPath, setTestPath] = useState(''), [historyFilter, setHistoryFilter] = useState('all');
  const [showLegacy, setShowLegacy] = useState(false), [visualPhase, setVisualPhase] = useState(null), [paused, setPaused] = useState(false);
  const token = session?.accessToken;
  const request = useCallback(async (path, method = 'GET', body) => {
    const response = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (response.status === 401) { localStorage.removeItem('testopt-session'); setSession(null); setProjects([]); setProjectId(''); setVersions([]); setVersionId(''); setPlans([]); setCurrentId(''); }
    if (!response.ok) throw new Error(data.message || 'Request failed.'); return data;
  }, [token]);
  const source = `/source/projects/${projectId}`;
  const project = projects.find(item => item.projectId === projectId);
  const version = versions.find(item => item.versionId === versionId);
  const current = plans.find(item => item.planId === currentId);
  const model = useMemo(() => buildWorkspaceModel(version, current, plans), [version, current, plans]);
  const executing = plans.some(item => ['QUEUED', 'EXECUTING'].includes(item.status));
  const archived = Boolean(project?.archivedAt);
  const phase = visualPhase ?? Math.max(0, model.activeStage);
  const versionNumber = id => { const index = [...versions].reverse().findIndex(item => item.versionId === id); return index < 0 ? 'Unknown version' : `Version ${index + 1}`; };

  useEffect(() => { const change = () => setPage(pageFromHash()); addEventListener('hashchange', change); return () => removeEventListener('hashchange', change); }, []);
  useEffect(() => { document.title = `TestOpt · ${PAGES.find(([key]) => key === page)?.[1]}`; }, [page]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const data = await request('/catalog/projects?includeArchived=true'); if (active) { setProjects(data.projects); setProjectId(data.projects.find(item => !item.archivedAt)?.projectId || data.projects[0]?.projectId || ''); } }
      catch (problem) { if (active) setError(problem.message); } finally { if (active) setLoading(false); }
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [token, request]);
  useEffect(() => {
    if (!projectId || !token) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [uploaded, saved] = await Promise.all([request(`${source}/versions`), request(`${source}/plans`)]);
        if (active) { const id = initialVersion(uploaded.versions); setVersions(uploaded.versions); setVersionId(id); setPlans(saved.plans); setCurrentId(saved.plans.find(item => item.versionId === id)?.planId || ''); if (saved.plans[0]) { setBudget(saved.plans[0].plan.timeBudget); setWorkers(saved.plans[0].plan.workerCount); } }
      } catch (problem) { if (active) setError(problem.message); } finally { if (active) setLoading(false); }
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [projectId, source, token, request]);
  useEffect(() => {
    if (!executing) return;
    let active = true, pending = false;
    const timer = setInterval(async () => { if (pending) return; pending = true;
      try { const [saved, uploaded] = await Promise.all([request(`${source}/plans`), request(`${source}/versions`)]); if (active) { setPlans(saved.plans); setVersions(uploaded.versions); } }
      catch (problem) { if (active) setError(problem.message); } finally { pending = false; }
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [executing, source, request]);
  useEffect(() => { if (visualPhase == null || paused || page !== 'pipeline') return; const timer = setInterval(() => setVisualPhase(value => (value + 1) % 6), 4200); return () => clearInterval(timer); }, [visualPhase, paused, page]);
  useEffect(() => {
    if (!setup) return;
    const modal = document.querySelector('.modal');
    const previous = document.activeElement;
    const focusable = () => [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];
    const timer = setTimeout(() => (modal.querySelector('input:not(:disabled)') || focusable()[0])?.focus(), 0);
    const keyboard = event => {
      if (event.key === 'Escape' && !busy) setSetup('');
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!items.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    addEventListener('keydown', keyboard);
    return () => { clearTimeout(timer); removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, [setup, busy]);

  function chooseProject(id) { setProjectId(id); setVersions([]); setVersionId(''); setPlans([]); setCurrentId(''); setTestPath(''); setError(''); setNotice(''); setVisualPhase(null); }
  function chooseVersion(id) { setVersionId(id); setCurrentId(plans.find(item => item.versionId === id)?.planId || ''); setTestPath(''); setVisualPhase(null); }
  function openRun(run, target = 'history') { setCurrentId(run.planId); setVersionId(run.versionId); setVisualPhase(null); location.hash = target; }
  function goUpload() { setSetup(projectId ? 'upload' : 'project'); }
  async function perform(action) { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (problem) { setError(problem.message); } finally { setBusy(false); } }
  async function createProject(event) { event.preventDefault(); await perform(async () => { const data = await request('/catalog/projects', 'POST', { projectName: newName.trim(), organizationId: session.organizations?.[0]?.organizationId }); const fresh = await request('/catalog/projects?includeArchived=true'); setProjects(fresh.projects); chooseProject(data.project.projectId); setNewName(''); setSetup('upload'); }); }
  async function upload(fileList) { if (!fileList.length) return; await perform(async () => { const upload = await readProjectUpload(fileList); const data = await request(`${source}/versions`, 'POST', { files: upload.files }); const fresh = await request(`${source}/versions`); setVersions(fresh.versions); setVersionId(data.versionId); setCurrentId(''); setSetup(''); location.hash = 'dashboard'; setNotice(`Uploaded ${upload.files.length} source files${upload.excluded ? `; excluded ${upload.excluded} generated, hidden, or unsupported files` : ''}. Review the discovery, then run the optimizer.`); }); }
  async function prepare() { await perform(async () => { const data = await request(`${source}/versions/${versionId}/plan`, 'POST', { timeBudget: Number(budget), workerCount: Number(workers), algorithm }); setPlans(items => [{ ...data, versionId, status: 'PLANNED', results: [], createdAt: new Date().toISOString() }, ...items]); setCurrentId(data.planId); setVisualPhase(null); location.hash = 'dashboard'; setNotice('Plan prepared. Review the selected tests before approving execution.'); }); }
  async function approve() { await perform(async () => { try { await request(`${source}/plans/${currentId}/approve`, 'POST', { approved: true }); } finally { setPlans((await request(`${source}/plans`)).plans); } }); }
  async function reject() { await perform(async () => { await request(`${source}/plans/${currentId}/reject`, 'POST', {}); setPlans((await request(`${source}/plans`)).plans); setNotice('Plan rejected. Adjust your preferences in Settings, then prepare a new plan.'); }); }
  async function download() { await perform(async () => { const data = await request(`${source}/plans/${currentId}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `testopt-${currentId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }
  async function archive() { if (!confirm(`Archive ${project.projectName}? Its history is preserved, but it cannot accept new runs.`)) return; await perform(async () => { await request(`/catalog/projects/${projectId}`, 'DELETE'); setProjects((await request('/catalog/projects?includeArchived=true')).projects); setNotice('Project archived. Its saved history remains available.'); }); }
  function signOut() { localStorage.removeItem('testopt-session'); setSession(null); chooseProject(''); setProjects([]); }
  if (!token) return <AuthScreen onAuthenticated={data => { localStorage.setItem('testopt-session', JSON.stringify(data)); setError(''); setNotice(''); setSession(data); }} />;

  const alerts = <>{error && <div className="alert" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}{notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}{archived && <div className="caution">Archived project · History is available; uploads and new execution are disabled.</div>}</>;
  const actions = <><button className="btn" disabled={busy} onClick={() => setSetup('project')}>+ New project</button><button className="btn" onClick={goUpload} disabled={busy || archived}>↑ Upload version</button></>;
  const settings = <><section className="card"><h2>Optimization preferences</h2><p className="note">Automatic mode chooses an algorithm from the project evidence. You can leave these defaults as they are.</p><div className="settings-grid"><label>Time budget (minutes)<input type="number" min="0.001" max="1440" step="0.001" value={budget} onChange={event => setBudget(event.target.value)} /></label><label>Execution workers<select value={workers} onChange={event => setWorkers(event.target.value)}>{[1, 2, 3, 4].map(value => <option key={value}>{value}</option>)}</select></label><label>Algorithm<select value={algorithm} onChange={event => setAlgorithm(event.target.value)}><option value="AUTO">Automatic (recommended)</option><option value="GREEDY">Greedy</option><option value="KNAPSACK">0/1 Knapsack</option><option value="BRANCH_AND_BOUND">Branch and Bound</option></select></label></div><p className="fine-print">The optimizer prepares a proposal. Running your code requires explicit approval. Budget and evidence gaps remain visible in the results.</p></section><section className="card"><h2>Project & uploads</h2><p className="note">Current adapter: dependency-free JavaScript projects using Node’s built-in node:test runner. Upload the source folder including package.json and your test files. External packages and unsupported runners are reported during discovery.</p><div className="plan-actions">{actions}<button className="btn danger" disabled={!project || archived || busy || executing} onClick={archive}>Archive project</button></div></section><section className="card"><h2>Advanced tools</h2><p className="note">The manual catalog, CSV import, and simulated optimization workflow remain available for experiments.</p><button className="btn" onClick={() => setShowLegacy(!showLegacy)}>{showLegacy ? 'Hide' : 'Open'} manual tools</button>{showLegacy && <div className="legacy-workspace"><LegacyWorkspace /></div>}</section></>;
  const captions = [
    ['A change enters the city', `${model.changedFiles.length} changed files in ${version ? versionNumber(versionId) : 'your project'}. Violet beams mark changed source modules.`],
    ['Follow the impact', `${model.analysis?.dependencies?.length || 0} discovered dependency links connect source modules. Buildings represent the uploaded code.`],
    ['Value the relevant tests', 'Selection scores combine change relevance, module criticality, failure history, and marginal coverage. Inspect exact factors in Test suite.'],
    ['A focused test plan', current ? `${model.selected} of ${model.total} test files selected by ${model.plan.algorithm}. ${current.status === 'PLANNED' ? 'Awaiting your approval.' : current.status}` : 'Run the optimizer on the dashboard to prepare a plan.'],
    ['Watch execution evidence', `${current?.results?.length || 0} actual results recorded. Green means passed; pink means a failure or error. Unexecuted tests have no outcome.`],
    ['Keep the full picture', `${current ? `Run status: ${current.status}. ` : ''}Review results and validation gaps in Run history. Time comparisons are estimates.`],
  ];
  return <>
    <VisualScene city={page === 'pipeline'} analysis={model.analysis} tests={model.tests} changedFiles={model.changedFiles} phase={phase} paused={paused} />
    {page === 'pipeline' ? <div className="city-ui"><header className="city-bar card"><Logo /><Navigation page={page} compact /><div className="city-actions"><button className="btn" onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button><button className="btn" disabled={!version} onClick={() => { setVisualPhase(0); setPaused(false); }}>Replay</button>{visualPhase != null && <button className="btn" onClick={() => setVisualPhase(null)}>Live state</button>}</div></header><div className="city-steps">{STAGES.map((stage, index) => <button key={stage.name} style={{ '--c': stage.color }} className={phase === index ? 'act' : ''} onClick={() => { setVisualPhase(index); setPaused(true); }}><i />{stage.name}</button>)}</div><div className="city-stats">{[[model.total, 'Total tests'], [model.selected ?? '—', 'Selected'], [model.skippedPercent == null ? '—' : `${model.skippedPercent}%`, 'Skipped'], [model.savedEstimate == null ? '—' : formatDuration(model.savedEstimate), 'Est. saved']].map(([value, label]) => <div className="card" key={label}><b>{value}</b><span>{label}</span></div>)}</div><section className="card city-caption"><span className="eyebrow" style={{ color: STAGES[phase].color }}>{STAGES[phase].name}</span><h1>{captions[phase][0]}</h1><p>{captions[phase][1]}</p><p className="fine-print">{visualPhase == null ? 'Current workflow state' : 'Visualization replay · no jobs are launched'} · {project?.projectName || 'No project selected'}</p><a className="inline-link" href="#dashboard">← Back to dashboard</a></section><aside className="card city-legend"><strong>The data city</strong>{STAGES.map(stage => <span key={stage.name}><i style={{ background: stage.color }} />{stage.name}</span>)}<small>Source modules are buildings.<br />Test files form their floors.</small></aside></div> : <div className={`app ${page === 'dashboard' ? 'dashboard-app' : ''}`}><aside className="card side"><Logo /><Navigation page={page} /><div className="side-project"><label>PROJECT<select value={projectId} onChange={event => chooseProject(event.target.value)} disabled={busy || loading}><option value="">Choose project</option>{projects.map(item => <option key={item.projectId} value={item.projectId}>{item.projectName}{item.archivedAt ? ' (archived)' : ''}</option>)}</select></label>{actions}</div><div className="side-account"><span className="avatar">{session.user?.name?.slice(0, 1) || 'T'}</span><div><strong>{session.user?.name}</strong><button onClick={signOut}>Sign out</button></div></div></aside><main className="workspace"><header className="head"><div><h1>{PAGES.find(([key]) => key === page)?.[1]}</h1><div className="sub">{project?.projectName || 'Your testing workspace'}{version ? ` · ${versionNumber(versionId)} · ${model.changedFiles.length} changed files` : ' · Upload a project to begin'}</div></div>{page === 'dashboard' ? <button className="run" onClick={prepare} disabled={busy || loading || executing || archived || !version?.analysis?.supported || !Number.isFinite(Number(budget)) || Number(budget) <= 0}>{busy ? 'Working…' : executing ? 'Execution in progress…' : 'Run optimizer →'}</button> : page === 'history' ? <button className="btn" disabled={!current || busy} onClick={download}>↓ Export run</button> : <button className="btn" onClick={goUpload} disabled={busy || archived}>↑ Upload version</button>}</header>{alerts}{versions.length > 0 && <div className="version-bar"><label>Source version<select aria-label="Source version" value={versionId} disabled={busy || loading} onChange={event => chooseVersion(event.target.value)}>{versions.map(item => <option key={item.versionId} value={item.versionId}>{versionNumber(item.versionId)}{item.baselineReady ? ' · baseline available' : ''}</option>)}</select></label><span>{version?.analysis?.tests?.length || 0} discovered tests · {version?.analysis?.modules?.length || 0} source modules</span></div>}{loading ? <div className="card loading" role="status">Loading your workspace…</div> : page === 'dashboard' ? <Dashboard model={model} current={current} version={version} versions={versions} versionId={versionId} busy={busy} executing={executing} archived={archived} goUpload={goUpload} chooseVersion={chooseVersion} approve={approve} reject={reject} download={download} openRun={openRun} onPick={test => { setTestPath(test.path); location.hash = 'suite'; }} /> : page === 'suite' ? <Suite key={`${projectId}:${versionId}`} model={model} version={version} testPath={testPath} setTestPath={setTestPath} /> : page === 'history' ? <History model={model} plans={plans} current={current} currentId={currentId} versionNumber={versionNumber} openRun={openRun} download={download} filter={historyFilter} setFilter={setHistoryFilter} /> : settings}<footer className="workspace-footer">TestOpt · Change-aware test selection · Real execution evidence</footer></main></div>}
    {setup && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) setSetup(''); }}><section className="card modal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><button className="modal-close" disabled={busy} onClick={() => setSetup('')} aria-label="Close dialog">×</button><span className="eyebrow">PROJECT WORKSPACE</span><h2 id="setup-title">{setup === 'project' ? 'Create a project' : 'Upload your source folder'}</h2>{error && <p role="alert" className="alert">{error}</p>}{setup === 'project' ? <form onSubmit={createProject}><label>Project name<input autoFocus required maxLength="150" value={newName} onChange={event => setNewName(event.target.value)} /></label><button className="run" disabled={busy || !newName.trim()}>{busy ? 'Creating…' : 'Create project →'}</button></form> : <><p>Choose the project folder containing package.json, source files, and tests. Upload the full folder again whenever you want to analyze a new version.</p><label className="upload-zone">↑<strong>{busy ? 'Analyzing your source…' : 'Choose project folder'}</strong><span>Up to 300 source files · 5 MB total</span><input aria-label="Project folder" type="file" multiple webkitdirectory="" disabled={busy || archived} onChange={event => { upload(event.target.files); event.target.value = ''; }} /></label><p className="fine-print">Generated folders, dependency folders, and .env files are excluded. Uploading inspects your code; execution starts only after you approve a plan.</p></>}</section></div>}
  </>;
}
