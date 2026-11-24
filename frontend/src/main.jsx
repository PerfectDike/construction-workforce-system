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
    <p>Task {task.sharedId ?? task.taskCode} is {task.status?.toLowerCase() ?? 'working'}.</p>
    {task.status === 'WORKING' && <>
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
    <ActionForm button="Mark task inactive" busy={busy} onSave={async values => {
      await mutate(`${taskPath}/inactivate`, 'POST', { reason: values.get('reason').trim() })
      return 'Task marked inactive. Its earlier records remain available.'
    }}>
      <label>Reason for inactivation<input name="reason" required /></label>
    </ActionForm>
    </>}
    <h3>Create project task</h3>
    <ActionForm button="Create task" busy={busy} onSave={async values => {
      const saved = await mutate(`/projects/${task.projectId}/tasks`, 'POST', {
        taskCode: values.get('taskCode').trim().toUpperCase(),
        title: values.get('newTitle').trim(), startDate: values.get('newStartDate'),
        finishDate: values.get('newFinishDate'), isMilestone: values.has('newMilestone'),
        predecessorIds: values.get('newPredecessors').split(',').map(id => id.trim()).filter(Boolean)
      })
      return `Task ${saved.sharedId} created. Open its ID to review it.`
    }}>
      <label>New task ID<input name="taskCode" placeholder="T107" pattern="T[0-9]{3,}" required /></label>
      <label>New task title<input name="newTitle" required /></label>
      <label>Start date<input name="newStartDate" type="date" required /></label>
      <label>Finish date<input name="newFinishDate" type="date" required /></label>
      <label><input name="newMilestone" type="checkbox" /> Milestone</label>
      <label>Predecessor IDs (comma separated)<input name="newPredecessors" /></label>
    </ActionForm>
    <h3>Approve baseline</h3>
    <p>{baselines.length ? `Latest approved baseline is version ${baselines[0].versionNo}.` : 'No approved baseline yet.'} Approval snapshots the working plan for the whole project.</p>
    <ActionForm button="Approve project baseline" busy={busy} onSave={async values => {
      const saved = await mutate(`/projects/${task.projectId}/baselines`, 'POST', { reason: values.get('reason').trim() || undefined })
      return `Baseline version ${saved.versionNo} approved.`
    }}>
      <label>Baseline reason {baselines.length ? '(required for revision)' : '(optional)'}<input name="reason" required={baselines.length > 0} /></label>
    </ActionForm>
  </section>
}

function ProjectAccounts({ workflow, busy, mutate }) {
  const project = workflow.task.project
  return <section>
    <h3>Project accounts</h3>
    <p>Create a fictional account for this project. The local test mailbox receives its temporary password.</p>
    <ActionForm button="Create project account" busy={busy} onSave={async values => {
      const account = await mutate(`/projects/${project.sharedId || project.id}/accounts`, 'POST', {
        loginLabel: values.get('loginLabel'), roleName: values.get('roleName')
      })
      return `${account.loginLabel} added as ${account.roleName.replace('_', ' ').toLowerCase()}.`
    }}>
      <label>Fictional email<input name="loginLabel" type="email" pattern=".+@example\.test" required /></label>
      <label>Project role<select name="roleName" required>
        <option value="VIEWER">Viewer</option><option value="SITE_OFFICER">Site officer</option><option value="PROJECT_MANAGER">Project manager</option>
      </select></label>
    </ActionForm>
  </section>
}

function Workforce({ workflow, busy, mutate, token }) {
  const [probeDate, setProbeDate] = useState('')
  const [options, setOptions] = useState(null)
  const [optionsError, setOptionsError] = useState('')
  const { task, workers, allocations, baselines, allocationHistory = [] } = workflow
  useEffect(() => {
    if (!probeDate || !workflow.permissions.allocate) return
    const controller = new AbortController()
    call(`/tasks/${encodeURIComponent(task.sharedId ?? task.id)}/workforce-options?date=${encodeURIComponent(probeDate)}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setOptions(result); setOptionsError('') } })
      .catch(error => { if (!controller.signal.aborted) setOptionsError(error.message) })
    return () => controller.abort()
  }, [probeDate, task.id, workflow, token])
  return <section>
    <h3>Worker allocations</h3>
    {allocations.length ? <ul>{allocations.map(row =>
      <li key={row.id}>{row.worker.label} ({row.worker.sharedId}) · {day(row.workDate)} · {row.allocatedHours} hours · Allocation {row.id}
        {workflow.permissions.allocate && <details>
          <summary>Edit or cancel allocation {row.id}</summary>
          <ActionForm button="Save allocation change" busy={busy} onSave={async values => {
            await mutate(`/allocations/${row.id}`, 'PATCH', {
              workerId: values.get('workerId'), workDate: values.get('workDate'),
              hours: Number(values.get('hours')), reason: values.get('reason').trim()
            })
            return 'Allocation change saved.'
          }}>
            <label>Worker<select name="workerId" defaultValue={row.worker.sharedId} required>
              {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
            </select></label>
            <label>Work date<input name="workDate" type="date" defaultValue={day(row.workDate)} required /></label>
            <label>Hours<input name="hours" type="number" min="0.01" step="0.01" defaultValue={row.allocatedHours} required /></label>
            <label>Reason<input name="reason" required /></label>
          </ActionForm>
          <ActionForm button="Cancel allocation" busy={busy} onSave={async values => {
            await mutate(`/allocations/${row.id}/cancel`, 'POST', { reason: values.get('reason').trim() })
            return 'Allocation cancelled.'
          }}>
            <label>Cancellation reason<input name="reason" required /></label>
          </ActionForm>
        </details>}
      </li>
    )}</ul> : <p>No approved allocations.</p>}
    {workflow.permissions.allocate && allocationHistory.length > 0 && <details>
      <summary>Allocation history</summary>
      <ul>{allocationHistory.map(row => <li key={row.id}>
        Allocation {row.id} · {row.worker.label} ({row.worker.sharedId}) · {day(row.workDate)} · {row.allocatedHours} hours · {row.status}
        {row.replacesId && ` · Replaces ${row.replacesId}`}
        {row.reason && ` · Reason: ${row.reason}`}
        {row.events?.map((event, index) => <span key={index}>
          {' · '}{event.action} by {event.actor.loginLabel} at {new Date(event.occurredAt).toLocaleString()}
          {event.reason && ` · Reason: ${event.reason}`}
        </span>)}
      </li>)}</ul>
    </details>}
    {workflow.permissions.allocate && <>
      <label>Check worker availability for a date<input type="date" value={probeDate}
        onChange={event => { setProbeDate(event.target.value); setOptions(null) }} /></label>
      {optionsError && <p role="alert">{optionsError}</p>}
      {options && <ul>{options.workers.map(row => <li key={row.workerId}>
        {row.label} ({row.workerId}): {row.eligible ? `${row.remainingHours} hours remaining` : row.flags.map(flag => flag.replaceAll('_', ' ').toLowerCase()).join(', ')}
      </li>)}</ul>}
      <details>
        <summary>Record a worker availability change</summary>
        <p>Use this when a dated availability record changes. Any approved allocations above the new capacity are listed immediately.</p>
        <ActionForm button="Save availability" busy={busy} onSave={async values => {
          const result = await mutate(`/projects/${task.project.sharedId ?? task.project.id}/workers/${values.get('workerId')}/availability/${values.get('workDate')}`, 'PATCH', {
            availableHours: Number(values.get('availableHours')), reason: values.get('reason').trim()
          })
          return result.affected
            ? `${result.allocatedHours} allocated hours now exceed ${result.capacityHours} available hours. Review ${result.impactedAllocations.length} allocation(s).`
            : 'Availability change saved. No allocation is over capacity.'
        }}>
          <label>Worker<select name="workerId" required>{workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}</select></label>
          <label>Availability date<input name="workDate" type="date" defaultValue={probeDate} required /></label>
          <label>Available hours<input name="availableHours" type="number" min="0" max="24" step="0.01" required /></label>
          <label>Reason<input name="reason" required /></label>
        </ActionForm>
      </details>
    </>}
    {workflow.permissions.allocate && baselines.length > 0 && workers.length > 0 &&
      <ActionForm button="Allocate worker" busy={busy} onSave={async values => {
        await mutate('/allocations', 'POST', {
          workerId: values.get('workerId'), taskId: task.sharedId ?? task.id,
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
        {' · '}{update.status === 'SUBMITTED' ? 'Awaiting approval' : update.status}
        {update.supersedesId && ` · Corrects update ${update.supersedesId}`}
        {update.actualFinishDate && ` · Actual finish ${day(update.actualFinishDate)}`}
      </p>
      {update.note && <p>{update.note}</p>}
      {update.decisionReason && <p>Decision reason: {update.decisionReason}</p>}
      {update.canApprove && <ActionForm button={`Approve update ${update.id}`} busy={busy} onSave={async () => {
        await mutate(`/site-updates/${update.id}/approve`, 'POST', {})
        return 'Site update approved.'
      }} />}
      {permissions.approveHours && update.status === 'SUBMITTED' && <ActionForm button={`Reject update ${update.id}`} busy={busy} onSave={async values => {
        await mutate(`/site-updates/${update.id}/reject`, 'POST', { reason: values.get('reason').trim() })
        return 'Site update rejected.'
      }}>
        <label>Rejection reason<input name="reason" required /></label>
      </ActionForm>}
      {permissions.approveHours && update.status === 'APPROVED' && update.isCurrent && <ActionForm button={`Withdraw update ${update.id}`} busy={busy} onSave={async values => {
        await mutate(`/site-updates/${update.id}/withdraw`, 'POST', { reason: values.get('reason').trim() })
        return 'Site update withdrawn.'
      }}>
        <label>Withdrawal reason<input name="reason" required /></label>
      </ActionForm>}
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
      {workflow.permissions.plan && <ProjectAccounts workflow={workflow} busy={busy} mutate={mutate} />}
      <Workforce workflow={workflow} busy={busy} mutate={mutate} token={token} />
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

function ProjectReports({ session, openTask }) {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [baselines, setBaselines] = useState([])
  const [baselineId, setBaselineId] = useState('')
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const token = session.token

  useEffect(() => {
    const controller = new AbortController()
    call('/projects', { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setProjects(result.projects) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    setBaselines([])
    setBaselineId('')
    setReport(null)
    if (!projectId) return
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setBaselines(result.baselines) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [projectId, token])

  async function loadReport(event) {
    event.preventDefault()
    setError('')
    setReport(null)
    const query = new URLSearchParams({ asOf })
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (baselineId) query.set('baselineId', baselineId)
    try {
      setReport(await call(`/reports/projects/${encodeURIComponent(projectId)}?${query}`, { token }))
    } catch (err) { setError(err.message) }
  }

  return <section>
    <h2>Project schedule and hours</h2>
    <form onSubmit={loadReport}>
      <label>Project<select value={projectId} onChange={event => setProjectId(event.target.value)} required>
        <option value="">Choose a project</option>
        {projects.map(project => <option key={project.sharedId} value={project.sharedId}>{project.name} ({project.sharedId})</option>)}
      </select></label>
      <label>Approved baseline<select value={baselineId} onChange={event => setBaselineId(event.target.value)}>
        <option value="">Latest approved baseline</option>
        {baselines.map(row => <option key={row.id} value={row.id}>Version {row.versionNo} · {day(row.approvedAt)}</option>)}
      </select></label>
      <label>Report date<input type="date" value={asOf} onChange={event => setAsOf(event.target.value)} required /></label>
      <label>Period start<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Period end<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button>Show project report</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <h3>{report.project.name} · baseline version {report.baseline.versionNo}</h3>
      <p>Report date {report.reportDate}. Hours period {report.from} to {report.to}.</p>
      <p>{report.totals.taskCount} tasks · {report.totals.unfinished} unfinished · {report.totals.overdue} overdue · {report.totals.plannedHours} planned hours · {report.totals.recordedHours ?? 'No'} recorded hours</p>
      <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Baseline finish</th><th scope="col">Actual finish</th><th scope="col">Variance</th><th scope="col">Planned hours</th><th scope="col">Recorded hours</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{report.tasks.map(row => <tr key={row.taskId}>
          <th scope="row"><button type="button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button></th>
          <td>{row.status === 'not_reported' ? 'Not reported' : row.status}{row.overdue ? ' · Overdue' : ''}</td>
          <td>{day(row.baselineFinish) || 'New task'}</td><td>{day(row.actualFinish) || 'Not reported'}</td>
          <td>{row.finishVarianceDays == null ? 'Not available' : `${row.finishVarianceDays > 0 ? '+' : ''}${row.finishVarianceDays} days`}</td>
          <td>{row.plannedHours}</td><td>{row.recordedHours ?? 'Not reported'}</td>
          <td><details><summary>Source records</summary>
            <p>Baseline {row.sources.baselineId ?? 'none'}; task {row.taskId}</p>
            <ul>{row.sources.allocations.map(source => <li key={`a${source.id}`}>Allocation {source.id} · {day(source.workDate)} · {source.allocatedHours} hours</li>)}
              {row.sources.updates.map(source => <li key={`u${source.id}`}>Update {source.id} · allocation {source.allocationId} · {day(source.workDate)} · {source.recordedHours ?? 'No'} hours</li>)}</ul>
          </details></td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>
}

function App() {
  const [session, setSession] = useState(null)
  const [taskId, setTaskId] = useState('T102')
  const [visit, setVisit] = useState(0)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  return <main>
    <h1>Construction Workforce System</h1>
    {!session && resetToken ? <>
      <h2>Reset password</h2>
      <ActionForm button="Set new password" onSave={async values => {
        const result = await call('/auth/recovery/reset', {
          method: 'POST', data: { token: resetToken, newPassword: values.get('newPassword') }
        })
        window.history.replaceState({}, '', window.location.pathname)
        setResetToken('')
        setRecoveryMessage(result.message)
        return result.message
      }}>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength="12" required /></label>
      </ActionForm>
    </> : !session && recoveryMode ? <>
      <h2>Recover account</h2>
      <p>A reset link will be sent to the configured local test mailbox for a fictional account.</p>
      <ActionForm button="Request reset link" onSave={async values => {
        const result = await call('/auth/recovery/request', {
          method: 'POST', data: { loginLabel: values.get('email') }
        })
        return result.message
      }}>
        <label>Account email<input name="email" type="email" autoComplete="username" required /></label>
      </ActionForm>
      <button type="button" onClick={() => setRecoveryMode(false)}>Back to sign in</button>
    </> : !session ? <>
      <h2>Sign in</h2>
      {recoveryMessage && <p role="status">{recoveryMessage}</p>}
      <ActionForm button="Sign in" onSave={async values => {
        setSession(await call('/auth/login', {
          method: 'POST', data: { loginLabel: values.get('email'), password: values.get('password') }
        }))
      }}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      </ActionForm>
      <button type="button" onClick={() => setRecoveryMode(true)}>Forgot password?</button>
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
      <ProjectReports session={session} openTask={id => { setTaskId(id); setVisit(current => current + 1) }} />
      <TaskWorkspace key={`${taskId}-${visit}`} taskId={taskId} session={session} />
    </>}
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
