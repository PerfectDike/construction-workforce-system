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

function Workforce({ workflow, busy, mutate }) {
  const { task, workers, allocations, baselines } = workflow
  return <section>
    <h3>Worker allocations</h3>
    {allocations.length ? <ul>{allocations.map(row =>
      <li key={row.id}>{row.worker.label} ({row.worker.sharedId}) · {day(row.workDate)} · {row.allocatedHours} hours · Allocation {row.id}</li>
    )}</ul> : <p>No approved allocations.</p>}
    {workflow.permissions.allocate && task.sharedId && baselines.length > 0 && workers.length > 0 &&
      <ActionForm button="Allocate worker" busy={busy} onSave={async values => {
        await mutate('/allocations', 'POST', {
          workerId: values.get('workerId'), taskId: task.sharedId,
          workDate: values.get('workDate'), hours: Number(values.get('hours'))
        })
        return 'Worker allocated.'
      }}>
        <label>Worker<select name="workerId" required>
          <option value="">Choose a worker</option>
          {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
        </select></label>
        <label>Allocation date<input name="workDate" type="date" required /></label>
        <label>Allocation hours<input name="hours" type="number" min="0.01" step="0.01" required /></label>
      </ActionForm>}
    {workflow.permissions.allocate && !baselines.length && <p>Approve a project baseline to allocate workers.</p>}
  </section>
}

function SiteUpdates({ workflow, busy, mutate }) {
  const [allocationId, setAllocationId] = useState('')
  const { allocations, permissions, updates } = workflow
  if (!permissions.submitHours && !permissions.approveHours) return null
  const selected = allocations.find(row => String(row.id) === allocationId)
  const current = updates.filter(row => row.allocationId === selected?.id && row.status === 'APPROVED')
  return <section>
    <h3>Site hours</h3>
    {updates.length ? <ul>{updates.map(update => <li key={update.id}>
      <p>Update {update.id} · Allocation {update.allocationId} · {day(update.workDate)} · {update.recordedHours ?? 'No'} hours
        {' · '}{update.status === 'SUBMITTED' ? 'Awaiting approval' : 'Approved'}
        {update.supersedesId && ` · Corrects update ${update.supersedesId}`}
        {update.actualFinishDate && ` · Actual finish ${day(update.actualFinishDate)}`}
      </p>
      {update.note && <p>{update.note}</p>}
      {update.canApprove && <ActionForm button={`Approve update ${update.id}`} busy={busy} onSave={async () => {
        await mutate(`/site-updates/${update.id}/approve`, 'POST', {})
        return 'Site update approved.'
      }} />}
    </li>)}</ul> : <p>No site hours submitted.</p>}
    {permissions.submitHours && (allocations.length ? <>
      <label>Site allocation<select value={allocationId} onChange={event => setAllocationId(event.target.value)} disabled={busy}>
        <option value="">Choose an allocation</option>
        {allocations.map(row => <option key={row.id} value={row.id}>
          Allocation {row.id} · {row.worker.label} · {day(row.workDate)}
        </option>)}
      </select></label>
      {selected && <ActionForm key={selected.id} button="Submit site hours" busy={busy} onSave={async values => {
        const correction = values.get('correction')
        await mutate('/site-updates', 'POST', {
          allocationId: selected.id, workDate: day(selected.workDate), recordedHours: Number(values.get('recordedHours')),
          actualFinishDate: values.get('actualFinishDate') || undefined, note: values.get('note').trim() || undefined,
          supersedesId: correction ? Number(correction) : undefined
        })
        return 'Site hours submitted for approval.'
      }}>
        {current.length > 0 && <label>Correction to approve<select name="correction" required>
          <option value="">Choose an approved update</option>
          {current.map(row => <option key={row.id} value={row.id}>Update {row.id} · {row.recordedHours} hours</option>)}
        </select></label>}
        <label>Recorded hours<input name="recordedHours" type="number" min="0" step="0.01" required /></label>
        <label>Actual finish date (optional)<input name="actualFinishDate" type="date" /></label>
        <label>Site note (optional)<textarea name="note" /></label>
      </ActionForm>}
    </> : <p>An approved allocation is needed to submit hours.</p>)}
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
      <Workforce workflow={workflow} busy={busy} mutate={mutate} />
      <SiteUpdates workflow={workflow} busy={busy} mutate={mutate} />
      {workflow.task.sharedId && <TaskReport workflow={workflow} token={token} />}
    </>}
  </>
}

function TaskReport({ workflow, token }) {
  const [baselineId, setBaselineId] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { task, baselines } = workflow

  useEffect(() => {
    if (!baselines.length) return
    const controller = new AbortController()
    const query = baselineId ? `?baselineId=${encodeURIComponent(baselineId)}` : ''
    setReport(null)
    setError('')
    setLoading(true)
    call(`/reports/tasks/${encodeURIComponent(task.sharedId)}${query}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setReport(result) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [baselineId, workflow, token])

  return <section>
    <h3>Task report</h3>
    {!baselines.length && <p>Approve a project baseline to view the task report.</p>}
    {baselines.length > 0 && <label>Report baseline<select value={baselineId} onChange={event => setBaselineId(event.target.value)}>
      <option value="">Latest approved baseline</option>
      {baselines.map(baseline => <option value={baseline.id} key={baseline.id}>Version {baseline.versionNo}</option>)}
    </select></label>}
    {loading && <p role="status">Loading task report…</p>}
    {error && <p role="alert">{error}</p>}
    {baselines.length > 0 && report && <>
      <p>Approved baseline version {report.baselineVersion} (ID {report.baselineId}).</p>
      <dl>
        <dt>Baseline finish</dt><dd>{day(report.baselineFinish) || 'Not in baseline'}</dd>
        <dt>Actual finish</dt><dd>{day(report.actualFinish) || 'Not reported'}</dd>
        <dt>Finish variance</dt><dd>{report.finishVarianceDays == null ? 'Not available' : `${report.finishVarianceDays > 0 ? '+' : ''}${report.finishVarianceDays} calendar days`}</dd>
        <dt>Planned allocation hours</dt><dd>{report.plannedHours}</dd>
        <dt>Approved recorded hours</dt><dd>{report.recordedHours ?? 'Not reported'}</dd>
      </dl>
      <details>
        <summary>View source records</summary>
        <h4>Baseline task</h4>
        {report.sources.baselineTask ? <p>Baseline {report.baselineId} · Task {report.taskId} · Finish {day(report.sources.baselineTask.finishDate)}</p> : <p>Task absent from selected baseline.</p>}
        <h4>Approved allocations</h4>
        {report.sources.allocations.length ? <ul>{report.sources.allocations.map(row =>
          <li key={row.id}>Allocation {row.id} · {day(row.workDate)} · {row.allocatedHours} planned hours</li>
        )}</ul> : <p>No source allocations.</p>}
        <h4>Current approved site updates</h4>
        {report.sources.updates.length ? <ul>{report.sources.updates.map(row =>
          <li key={row.id}>Update {row.id} · Allocation {row.allocationId} · {day(row.workDate)} · {row.recordedHours ?? 'No'} recorded hours
            {row.actualFinishDate && ` · Actual finish ${day(row.actualFinishDate)}`}</li>
        )}</ul> : <p>No approved source updates.</p>}
      </details>
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
