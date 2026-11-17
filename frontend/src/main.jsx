import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
const api = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'
function App() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [token, setToken] = useState('')
  const [task, setTask] = useState('T102'), [baseline, setBaseline] = useState(''), [report, setReport] = useState(null), [error, setError] = useState('')
  async function call(path, options = {}) {
    const response = await fetch(`${api}${path}`, options)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message || 'Request failed')
    return body
  }
  async function signIn(e) {
    e.preventDefault(); setError('')
    try { const result = await call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginLabel: email, password }) }); setToken(result.token); setPassword('') } catch (err) { setError(err.message) }
  }
  async function load(e) {
    e.preventDefault(); setError(''); setReport(null)
    try { setReport(await call(`/reports/tasks/${encodeURIComponent(task)}${baseline ? `?baselineId=${encodeURIComponent(baseline)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })) } catch (err) { setError(err.message) }
  }
  return <main><h1>Construction Workforce System</h1>
    {!token ? <form onSubmit={signIn}><h2>Sign in</h2><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button>Sign in</button></form> : <><button type="button" onClick={() => { setToken(''); setReport(null) }}>Sign out</button><form onSubmit={load}><h2>Task report</h2><label>Task ID<input value={task} onChange={e => setTask(e.target.value)} required /></label><label>Baseline ID (optional)<input value={baseline} onChange={e => setBaseline(e.target.value)} inputMode="numeric" /></label><button>Show report</button></form></>}
    {error && <p role="alert">{error}</p>}
    {report && <section><h2>Task {report.taskId}</h2><p>Current approved information; baseline version {report.baselineVersion} (ID {report.baselineId}).</p><dl><dt>Baseline finish</dt><dd>{report.baselineFinish?.slice(0, 10) ?? 'Not in baseline'}</dd><dt>Actual finish</dt><dd>{report.actualFinish?.slice(0, 10) ?? 'Not reported'}</dd><dt>Finish variance</dt><dd>{report.finishVarianceDays == null ? 'Not available' : `${report.finishVarianceDays} calendar days`}</dd><dt>Planned allocation hours</dt><dd>{report.plannedHours}</dd><dt>Approved recorded hours</dt><dd>{report.recordedHours == null ? 'Not reported' : report.recordedHours}</dd></dl><details><summary>View source records</summary><h3>Baseline task</h3><pre>{JSON.stringify(report.sources.baselineTask, null, 2)}</pre><h3>Allocations</h3><pre>{JSON.stringify(report.sources.allocations, null, 2)}</pre><h3>Current approved site updates</h3><pre>{JSON.stringify(report.sources.updates, null, 2)}</pre></details></section>}
  </main>
}
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)

