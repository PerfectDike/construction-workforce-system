import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const api = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'
export const day = value => value?.slice(0, 10) ?? ''

async function call(path, { token, method = 'GET', data, signal } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (data !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${api}${path}`, {
    method, headers, signal, body: data === undefined ? undefined : JSON.stringify(data)
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || 'Request failed')
  return body
}

export function ActionForm({ children, button, busy, onSave }) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (pending || busy) return
    const values = new FormData(event.currentTarget)
    setError('')
    setMessage('')
    setPending(true)
    try {
      const result = await onSave(values)
      setMessage(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return <form onSubmit={submit}>
    <fieldset disabled={pending || busy}>
      {children}
      <button>{button}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </form>
}

function Planning({ workflow, busy, mutate }) {
  const { task, baselines } = workflow
  const taskPath = `/tasks/${encodeURIComponent(task.sharedId ?? task.id)}`
  return <section>
    <h3>Working plan</h3>
    <ActionForm button="Save working plan" busy={busy} onSave={async values => {
      await mutate(taskPath, 'PATCH', {
        title: values.get('title').trim(), startDate: values.get('startDate'),
        finishDate: values.get('finishDate'), isMilestone: values.has('isMilestone'),
        predecessorIds: values.get('predecessors').split(',').map(id => id.trim()).filter(Boolean)
      })
      return 'Working plan saved.'
    }}>
      <label>Task title<input name="title" defaultValue={task.title} required pattern=".*\S.*" /></label>
      <label>Start date<input name="startDate" type="date" defaultValue={day(task.startDate)} required /></label>
      <label>Finish date<input name="finishDate" type="date" defaultValue={day(task.finishDate)} required /></label>
      <label><input name="isMilestone" type="checkbox" defaultChecked={task.isMilestone} /> Milestone</label>
      <label>Predecessor IDs (comma separated)<input name="predecessors"
        defaultValue={task.predecessors.map(({ predecessor }) => predecessor.sharedId ?? predecessor.id).join(', ')} /></label>
    </ActionForm>
    <h3>Approve baseline</h3>
    <p>{baselines.length ? `Latest approved baseline is version ${baselines[0].versionNo}.` : 'No approved baseline yet.'} Approval snapshots the working plan for the whole project.</p>
    <ActionForm button="Approve project baseline" busy={busy} onSave={async values => {
      const saved = await mutate(`/projects/${task.projectId}/baselines`, 'POST', { reason: values.get('reason').trim() || undefined })
      return `Baseline version ${saved.versionNo} approved.`
    }}>
      <label>Baseline reason (optional)<input name="reason" /></label>
    </ActionForm>
  </section>
}

function TaskWorkspace({ taskId, session }) {
  const [workflow, setWorkflow] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = `/tasks/${encodeURIComponent(taskId)}/workflow`
  const token = session.token

  async function refresh(signal) {
    const result = await call(path, { token, signal })
    if (!signal?.aborted) {
      setWorkflow(result)
      setError('')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => controller.abort()
  }, [path, token])

  async function mutate(url, method, data) {
    setBusy(true)
    try {
      const result = await call(url, { token, method, data })
      try {
        await refresh()
      } catch (err) {
        setError(`Change saved. Refresh the task to see it. ${err.message}`)
      }
      return result
    } finally {
      setBusy(false)
    }
  }

  return <>
    {error && <p role="alert">{error} <button type="button" onClick={() => refresh().catch(err => setError(err.message))}>Refresh task</button></p>}
    {!workflow && !error && <p role="status">Loading task…</p>}
    {workflow && <>
      <h2>{workflow.task.sharedId ?? workflow.task.taskCode} · {workflow.task.title}</h2>
      <p>{workflow.task.project.name} · Working dates {day(workflow.task.startDate)} to {day(workflow.task.finishDate)}</p>
      {workflow.permissions.plan && <Planning workflow={workflow} busy={busy} mutate={mutate} />}
      {workflow.task.sharedId && <LegacyReport taskId={workflow.task.sharedId} token={token} />}
    </>}
  </>
}

function LegacyReport({ taskId, token }) {
  const [report, setReport] = useState(null)
  return <section>
    <h3>Task report</h3>
    <ActionForm button="Show report" onSave={async values => {
      setReport(null)
      const baseline = values.get('baseline')
      setReport(await call(`/reports/tasks/${encodeURIComponent(taskId)}${baseline ? `?baselineId=${encodeURIComponent(baseline)}` : ''}`, { token }))
    }}>
      <label>Baseline ID (optional)<input name="baseline" inputMode="numeric" /></label>
    </ActionForm>
    {report && <>
      <p>Approved baseline version {report.baselineVersion} (ID {report.baselineId}).</p>
      <dl>
        <dt>Baseline finish</dt><dd>{day(report.baselineFinish) || 'Not in baseline'}</dd>
        <dt>Actual finish</dt><dd>{day(report.actualFinish) || 'Not reported'}</dd>
        <dt>Finish variance</dt><dd>{report.finishVarianceDays == null ? 'Not available' : `${report.finishVarianceDays} calendar days`}</dd>
        <dt>Planned allocation hours</dt><dd>{report.plannedHours}</dd>
        <dt>Approved recorded hours</dt><dd>{report.recordedHours ?? 'Not reported'}</dd>
      </dl>
      <details><summary>View source records</summary><pre>{JSON.stringify(report.sources, null, 2)}</pre></details>
    </>}
  </section>
}

function App() {
  const [session, setSession] = useState(null)
  const [taskId, setTaskId] = useState('T102')
  const [visit, setVisit] = useState(0)
  return <main>
    <h1>Construction Workforce System</h1>
    {!session ? <>
      <h2>Sign in</h2>
      <ActionForm button="Sign in" onSave={async values => {
        setSession(await call('/auth/login', {
          method: 'POST', data: { loginLabel: values.get('email'), password: values.get('password') }
        }))
      }}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      </ActionForm>
    </> : <>
      <p>Signed in as {session.user.loginLabel}</p>
      <button type="button" onClick={() => { setSession(null); setTaskId('T102') }}>Sign out</button>
      <form onSubmit={event => {
        event.preventDefault()
        setTaskId(new FormData(event.currentTarget).get('taskId').trim().toUpperCase())
        setVisit(current => current + 1)
      }}>
        <label>Task ID<input name="taskId" defaultValue={taskId} required pattern=".*\S.*" /></label>
        <button>Open task</button>
      </form>
      <TaskWorkspace key={visit} taskId={taskId} session={session} />
    </>}
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
