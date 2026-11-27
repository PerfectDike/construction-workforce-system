import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const api = import.meta.env.VITE_API_URL ?? '/api'
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

export function ActionForm({ children, button, busy, submitDisabled, onSave, validate, onConflict, onChange }) {
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (pending || busy) return
    const values = new FormData(event.currentTarget)
    setError('')
    setMessage('')
    const errors = validate?.(values) || {}
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
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

  return <form onSubmit={submit} onChange={onChange}>
    <fieldset disabled={pending || busy}>
      {typeof children === 'function' ? children(fieldErrors) : children}
      <button disabled={submitDisabled}>{button}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error} {onConflict && /allocation/i.test(error) &&
      <button type="button" onClick={onConflict}>Open workforce</button>}</p>}
  </form>
}

const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const FieldError = ({ id, message }) => message && <small id={id} className="field-error">{message}</small>

function validateWorkingPlan(values, taskId) {
  const errors = {}
  const start = values.get('startDate'), finish = values.get('finishDate')
  if (!values.get('title')?.trim()) errors.title = 'Enter an activity title.'
  if (!validDay(start)) errors.startDate = 'Enter a valid start date.'
  if (!validDay(finish)) errors.finishDate = 'Enter a valid finish date.'
  else if (validDay(start) && finish < start) errors.finishDate = 'Finish date must not precede start date.'
  else if (values.has('isMilestone') && validDay(start) && finish !== start) errors.finishDate = 'A milestone uses one date.'
  const ids = values.get('predecessors').split(',').map(id => id.trim().toUpperCase()).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.predecessors = 'List each predecessor once.'
  else if (ids.includes(String(taskId).toUpperCase())) errors.predecessors = 'An activity cannot depend on itself.'
  return errors
}

function planChangeSummary(beforeText, afterText) {
  try {
    const before = JSON.parse(beforeText), after = JSON.parse(afterText)
    const labels = { title: 'title', startDate: 'start date', finishDate: 'finish date', isMilestone: 'milestone status' }
    const changed = Object.entries(labels).filter(([key]) => before[key] !== after[key]).map(([, label]) => label)
    if (JSON.stringify(before.predecessorIds) !== JSON.stringify(after.predecessorIds)) changed.push('predecessor links')
    return changed.length ? `Changed ${changed.join(', ')}` : 'Saved without field changes'
  } catch { return 'Plan changed' }
}

function Planning({ workflow, busy, mutate, openWorkforce }) {
  const { task, baselines, allocations, planHistory = [] } = workflow
  const taskPath = `/tasks/${encodeURIComponent(task.sharedId ?? task.id)}`
  const [comparisonId, setComparisonId] = useState(String(baselines[0]?.id || ''))
  const [proposedStart, setProposedStart] = useState(day(task.startDate))
  const [proposedFinish, setProposedFinish] = useState(day(task.finishDate))
  const selectedBaseline = baselines.find(row => String(row.id) === comparisonId) || baselines[0]
  const affectedAllocations = allocations.filter(row => day(row.workDate) < proposedStart || day(row.workDate) > proposedFinish)
  return <section>
    <h3>Edit activity plan</h3>
    <p>{task.status === 'WORKING' ? 'This activity is in the working schedule.' : 'This activity is inactive.'} Edit the working schedule here; approved baselines remain available for comparison.</p>
    {baselines.length > 0 && <div className="plan-comparison">
      <label>Compare with approved schedule<select value={selectedBaseline?.id || ''} onChange={event => setComparisonId(event.target.value)}>
        {baselines.map(row => <option key={row.id} value={row.id}>Version {row.versionNo} · {day(row.approvedAt)}</option>)}
      </select></label>
      {selectedBaseline?.taskSnapshot ? <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Plan</th><th scope="col">Start</th><th scope="col">Finish</th><th scope="col">Predecessors</th></tr></thead>
        <tbody><tr><th scope="row">Approved version {selectedBaseline.versionNo}</th><td data-label="Start">{day(selectedBaseline.taskSnapshot.startDate)}</td><td data-label="Finish">{day(selectedBaseline.taskSnapshot.finishDate)}</td><td data-label="Predecessors">{selectedBaseline.predecessorIds.join(', ') || 'None'}</td></tr>
          <tr><th scope="row">Saved working plan</th><td data-label="Start">{day(task.startDate)}</td><td data-label="Finish">{day(task.finishDate)}</td><td data-label="Predecessors">{task.predecessors.map(edge => edge.predecessor.sharedId || edge.predecessor.id).join(', ') || 'None'}</td></tr></tbody>
      </table></div> : <p>This activity is new since the selected baseline.</p>}
      {selectedBaseline?.reason && <p>Approval reason: {selectedBaseline.reason}</p>}
    </div>}
    {allocations.length > 0 && <div className="allocation-impact"><h4>Saved worker assignments</h4>
      <p>Changing activity dates does not move worker assignments. Review their saved work dates before changing the plan.</p>
      <ul>{allocations.map(row => <li key={row.id}>Allocation {row.id}: {row.worker.label} · {day(row.workDate)} · {row.allocatedHours} hours</li>)}</ul>
      {affectedAllocations.length > 0 && <p role="alert">The proposed dates exclude {affectedAllocations.length} saved assignment(s). <button type="button" onClick={openWorkforce}>Open workforce</button></p>}
    </div>}
    {task.status === 'WORKING' && <>
    <ActionForm button="Save activity plan" busy={busy} validate={values => validateWorkingPlan(values, task.sharedId ?? task.id)} onConflict={openWorkforce}
      onSave={async values => {
      await mutate(taskPath, 'PATCH', {
        title: values.get('title').trim(), startDate: values.get('startDate'), reason: values.get('planReason')?.trim(),
        finishDate: values.get('finishDate'), isMilestone: values.has('isMilestone'),
        predecessorIds: values.get('predecessors').split(',').map(id => id.trim()).filter(Boolean)
      })
      return 'Activity plan saved.'
    }}>
      {errors => <>
        <label>Activity title<input name="title" defaultValue={task.title} required aria-invalid={!!errors.title} aria-describedby={errors.title ? 'plan-title-error' : undefined} /></label>
        <FieldError id="plan-title-error" message={errors.title} />
        <label>Start date<input name="startDate" type="date" defaultValue={day(task.startDate)} onChange={event => setProposedStart(event.target.value)} required aria-invalid={!!errors.startDate} aria-describedby={errors.startDate ? 'plan-start-error' : undefined} /></label>
        <FieldError id="plan-start-error" message={errors.startDate} />
        <label>Finish date<input name="finishDate" type="date" defaultValue={day(task.finishDate)} onChange={event => setProposedFinish(event.target.value)} required aria-invalid={!!errors.finishDate} aria-describedby={errors.finishDate ? 'plan-finish-error' : undefined} /></label>
        <FieldError id="plan-finish-error" message={errors.finishDate} />
        <label><input name="isMilestone" type="checkbox" defaultChecked={task.isMilestone} /> Milestone</label>
        <label>Predecessor activity IDs (separate with commas)<input name="predecessors" aria-invalid={!!errors.predecessors} aria-describedby={errors.predecessors ? 'plan-predecessors-error' : undefined}
          defaultValue={task.predecessors.map(({ predecessor }) => predecessor.sharedId ?? predecessor.id).join(', ')} /></label>
        <FieldError id="plan-predecessors-error" message={errors.predecessors} />
        <label>Reason for change (optional)<input name="planReason" /></label>
      </>}
    </ActionForm>
    {planHistory.length > 0 && <details className="action-panel"><summary>Working plan change history ({planHistory.length})</summary>
      <ul>{planHistory.map((event, index) => <li key={index}>{new Date(event.occurredAt).toLocaleString()} · {event.actor.loginLabel}
        {event.reason ? ` · ${event.reason}` : ''} · {planChangeSummary(event.fromState, event.toState)}</li>)}</ul>
    </details>}
    <details className="action-panel"><summary>Mark activity inactive</summary>
    <ActionForm button="Mark activity inactive" busy={busy} onSave={async values => {
      await mutate(`${taskPath}/inactivate`, 'POST', { reason: values.get('reason').trim() })
      return 'Task marked inactive. Its earlier records remain available.'
    }}>
      <label>Reason for inactivation<input name="reason" required /></label>
    </ActionForm></details>
    </>}
  </section>
}

function ProjectTaskCreation({ projectId, token, onCreated }) {
  return <section>
    <details className="action-panel"><summary>Create a project activity</summary>
      <p>Add an activity to the working schedule. It will be included in the next approved project baseline.</p>
      <ActionForm button="Create activity" onSave={async values => {
        const saved = await call(`/projects/${encodeURIComponent(projectId)}/tasks`, { token, method: 'POST', data: {
          taskCode: values.get('taskCode').trim().toUpperCase(), title: values.get('newTitle').trim(),
          startDate: values.get('newStartDate'), finishDate: values.get('newFinishDate'),
          isMilestone: values.has('newMilestone'),
          predecessorIds: values.get('newPredecessors').split(',').map(id => id.trim()).filter(Boolean)
        } })
        onCreated()
        return `Activity ${saved.sharedId} created. Select it from the activity list to review it.`
      }}>
        <label>Activity ID<input name="taskCode" placeholder="T107" pattern="T[0-9]{3,}" required /></label>
        <label>Activity title<input name="newTitle" required /></label>
        <label>Start date<input name="newStartDate" type="date" required /></label>
        <label>Finish date<input name="newFinishDate" type="date" required /></label>
        <label><input name="newMilestone" type="checkbox" /> Milestone</label>
        <label>Predecessor activity IDs, separated by commas<input name="newPredecessors" /></label>
      </ActionForm>
    </details>
  </section>
}

function ProjectBaselineApproval({ projectId, projectName, token, openOverview, onApproved }) {
  const [baselines, setBaselines] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [approved, setApproved] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setBaselines(result.baselines); setLoaded(true) } })
      .catch(error => { if (!controller.signal.aborted) { setReviewError(error.message); setLoaded(true) } })
    return () => controller.abort()
  }, [projectId, token])

  async function reviewBaseline() {
    setReviewError('')
    setApproved(null)
    setReviewBusy(true)
    try {
      const [schedule, versions] = await Promise.all([
        call(`/projects/${encodeURIComponent(projectId)}/tasks`, { token }),
        call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token })
      ])
      const latest = versions.baselines[0]
      setBaselines(versions.baselines)
      if (latest && !reason.trim()) { setReviewError('Give a reason for the revised baseline.'); return }
      const active = schedule.tasks.filter(row => row.status === 'WORKING')
      if (!active.length) { setReviewError('A schedule baseline needs at least one working activity.'); return }
      setPreview({ tasks: active, versionNo: (latest?.versionNo || 0) + 1, reason: reason.trim() })
    } catch (error) { setReviewError(error.message) }
    finally { setReviewBusy(false) }
  }

  return <section>
    <p className="eyebrow">Project-wide action</p>
    <h2>Approve project schedule</h2>
    <p>Review all working activities in {projectName} before approval. The approved baseline is a fixed record of this schedule. You can still edit the working schedule afterward.</p>
    {loaded && <p>{baselines.length ? `Latest approved baseline: version ${baselines[0].versionNo} (${day(baselines[0].approvedAt)}).` : 'This project has no approved baseline yet.'}</p>}
    <label>Approval reason {baselines.length ? '(required)' : '(optional)'}<input value={reason}
      onChange={event => { setReason(event.target.value); setPreview(null); setReviewError('') }} /></label>
    <button type="button" disabled={reviewBusy || !loaded} onClick={reviewBaseline}>Review all working activities</button>
    {reviewError && <p role="alert">{reviewError}</p>}
    {preview && <div className="baseline-preview" aria-label="Baseline review">
      <h3>Review project baseline version {preview.versionNo}</h3>
      <p>{preview.tasks.length} working activities will be saved. {preview.reason ? `Reason: ${preview.reason}` : 'Initial approval; no reason supplied.'}</p>
      <p className="scroll-hint">Scroll across the table to inspect every column.</p>
      <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Activity</th><th scope="col">Start</th><th scope="col">Finish</th><th scope="col">Milestone</th><th scope="col">Predecessors</th></tr></thead>
        <tbody>{preview.tasks.map(row => <tr key={row.id}>
          <th scope="row">{row.sharedId || row.taskCode} · {row.title}</th><td>{day(row.startDate)}</td><td>{day(row.finishDate)}</td>
          <td>{row.isMilestone ? 'Yes' : 'No'}</td><td>{row.predecessorIds.join(', ') || 'None'}</td>
        </tr>)}</tbody>
      </table></div>
      <p>The schedule is validated again when you approve it.</p>
      <ActionForm button="Approve this project baseline" onSave={async () => {
        const saved = await call(`/projects/${encodeURIComponent(projectId)}/baselines`, {
          token, method: 'POST', data: { reason: preview.reason || undefined }
        })
        setPreview(null)
        setReason('')
        setBaselines(current => [{ id: saved.id, versionNo: saved.versionNo, approvedAt: saved.approvedAt }, ...current])
        setApproved(saved)
        onApproved()
        return `Project baseline version ${saved.versionNo} approved.`
      }} />
    </div>}
    {approved && <div className="approval-result" role="status">
      <strong>Version {approved.versionNo} approved</strong>
      <span>{new Date(approved.approvedAt).toLocaleString()} · {approved.tasks.length} activities</span>
      <button type="button" onClick={openOverview}>View project overview</button>
    </div>}
  </section>
}

function ProjectAccounts({ projectId, token }) {
  return <section>
    <h2>Project accounts</h2>
    <p>Give a team member access to this project and choose their role.</p>
    <ActionForm button="Add project user" onSave={async values => {
      const account = await call(`/projects/${encodeURIComponent(projectId)}/accounts`, { token, method: 'POST', data: {
        loginLabel: values.get('loginLabel'), roleName: values.get('roleName')
      } })
      return `${account.loginLabel} can now access this project as ${account.roleName.replace('_', ' ').toLowerCase()}.`
    }}>
      <label>User email<input name="loginLabel" type="email" pattern=".+@example\.test" required /></label>
      <label>Project role<select name="roleName" required>
        <option value="VIEWER">Viewer</option><option value="SITE_OFFICER">Site officer</option><option value="PROJECT_MANAGER">Project manager</option>
      </select></label>
    </ActionForm>
  </section>
}

function Workforce({ workflow, busy, mutate, token }) {
  const [newWorkerId, setNewWorkerId] = useState('')
  const [newWorkDate, setNewWorkDate] = useState('')
  const [newHours, setNewHours] = useState('')
  const [options, setOptions] = useState(null)
  const [optionsError, setOptionsError] = useState('')
  const { task, workers, allocations, baselines, allocationHistory = [] } = workflow
  const selectedOption = options?.workers.find(row => row.workerId === newWorkerId)
  const exceedsCapacity = selectedOption?.remainingHours != null && Number(newHours) > selectedOption.remainingHours
  const optionMessages = {
    OUTSIDE_APPROVED_DATES: 'Date is outside the approved schedule',
    SKILL_MISMATCH: 'Required skill is missing',
    AVAILABILITY_UNKNOWN: 'Availability has not been recorded',
    OVER_CAPACITY: 'Existing allocations exceed available hours',
    FULLY_ALLOCATED: 'No hours remain on this date'
  }
  useEffect(() => {
    if (!validDay(newWorkDate) || !workflow.permissions.allocate) return
    const controller = new AbortController()
    call(`/tasks/${encodeURIComponent(task.sharedId ?? task.id)}/workforce-options?date=${encodeURIComponent(newWorkDate)}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setOptions(result); setOptionsError('') } })
      .catch(error => { if (!controller.signal.aborted) setOptionsError(error.message) })
    return () => controller.abort()
  }, [newWorkDate, task.id, workflow, token])
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
      <details>
        <summary>Record a worker availability change</summary>
        <p>Update a worker's hours for a date. The system will show any affected allocations.</p>
        <ActionForm button="Save availability" busy={busy} onSave={async values => {
          const result = await mutate(`/projects/${task.project.sharedId ?? task.project.id}/workers/${values.get('workerId')}/availability/${values.get('workDate')}`, 'PATCH', {
            availableHours: Number(values.get('availableHours')), reason: values.get('reason').trim()
          })
          return result.affected
            ? `${result.allocatedHours} allocated hours now exceed ${result.capacityHours} available hours. Review ${result.impactedAllocations.length} allocation(s).`
            : 'Availability change saved. No allocation is over capacity.'
        }}>
          <label>Worker<select name="workerId" required>{workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}</select></label>
          <label>Availability date<input key={newWorkDate} name="workDate" type="date" defaultValue={newWorkDate} required /></label>
          <label>Available hours<input name="availableHours" type="number" min="0" max="24" step="0.01" required /></label>
          <label>Reason<input name="reason" required /></label>
        </ActionForm>
      </details>
    </>}
    {workflow.permissions.allocate && baselines.length > 0 && workers.length > 0 &&
      <div className="allocation-form"><h4>Allocate a worker</h4>
      <p>Approved activity dates: {day(baselines[0].taskSnapshot?.startDate) || 'Not included'} to {day(baselines[0].taskSnapshot?.finishDate) || 'Not included'}.</p>
      <ActionForm button="Allocate worker" busy={busy} submitDisabled={!selectedOption?.eligible || exceedsCapacity}
        onSave={async values => {
        await mutate('/allocations', 'POST', {
          workerId: values.get('workerId'), taskId: task.sharedId ?? task.id,
          workDate: values.get('workDate'), hours: Number(values.get('hours'))
        })
        return 'Worker allocated.'
      }}>
        <label>Worker<select name="workerId" value={newWorkerId} onChange={event => setNewWorkerId(event.target.value)} required>
          <option value="">Choose a worker</option>
          {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
        </select></label>
        <label>Allocation date<input name="workDate" type="date" value={newWorkDate}
          onChange={event => { setNewWorkDate(event.target.value); setOptions(null); setOptionsError('') }} required /></label>
        <label>Allocation hours<input name="hours" type="number" min="0.01" step="0.01" value={newHours}
          onChange={event => setNewHours(event.target.value)} required /></label>
        {newWorkDate && <div className="allocation-check" role="status">
          {!options && !optionsError && <p>Checking workers for {newWorkDate}…</p>}
          {optionsError && <p role="alert">{optionsError}</p>}
          {options && !newWorkerId && <p>Select a worker to see the skill and capacity check.</p>}
          {selectedOption && <><strong>{selectedOption.label} · {newWorkDate}</strong>
            {selectedOption.eligible ? <p>Required skill and approved date checks passed. {selectedOption.remainingHours} hours remain after {selectedOption.committedHours} hours already allocated across projects.</p>
              : <ul>{selectedOption.flags.map(flag => <li key={flag}>{optionMessages[flag] || flag}</li>)}</ul>}
            {exceedsCapacity && <p role="alert">Requested hours exceed the {selectedOption.remainingHours} hours remaining.</p>}
          </>}
          {options && <details><summary>Compare all workers for this date</summary><ul>{options.workers.map(row =>
            <li key={row.workerId}>{row.label} ({row.workerId}): {row.eligible ? `${row.remainingHours} hours remaining` : row.flags.map(flag => optionMessages[flag] || flag).join('; ')}</li>
          )}</ul></details>}
        </div>}
      </ActionForm>
      <p className="explanation">The server checks the current approved schedule and cross-project capacity again when you save.</p>
      </div>}
    {workflow.permissions.allocate && !baselines.length && <p>Approve a project baseline to allocate workers.</p>}
  </section>
}

function SiteUpdates({ workflow, busy, mutate }) {
  const [allocationId, setAllocationId] = useState('')
  const { task, allocations, permissions, updates } = workflow
  if (!permissions.submitHours && !permissions.approveHours) return null
  const selected = allocations.find(row => String(row.id) === allocationId)
  const current = updates.filter(row => row.allocationId === selected?.id && row.status === 'APPROVED')
  return <section>
    <h3>Site hours</h3>
    <p>Submit hours against a worker allocation. Approved hours appear in the project report.</p>
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
    </> : <div className="next-step"><strong>Waiting for a worker allocation</strong>
      <p>A project manager must allocate a worker to {task.sharedId || task.taskCode} for a scheduled date. Once that allocation is approved, return here to submit site hours.</p>
    </div>)}
  </section>
}

function TaskWorkspace({ taskId, session, section, reportBaselineId, onTasksChange, openOverview, openWorkforce }) {
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
      if (/^\/(?:projects\/[^/]+\/tasks|tasks\/[^/]+(?:\/inactivate)?)$/.test(url)) onTasksChange?.()
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
      {section === 'planning' && workflow.permissions.plan && <Planning workflow={workflow} busy={busy} mutate={mutate} openWorkforce={openWorkforce} />}
      {section === 'workforce' && <Workforce workflow={workflow} busy={busy} mutate={mutate} token={token} />}
      {section === 'site' && <SiteUpdates workflow={workflow} busy={busy} mutate={mutate} />}
      {section === 'reports' && workflow.task.sharedId && <TaskReport workflow={workflow} token={token} baselineId={reportBaselineId} />}
      {section === 'planning' && !workflow.permissions.plan && <p>Your project role cannot change the working plan.</p>}
    </>}
  </>
}

function TaskReport({ workflow, token, baselineId }) {
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
    <h3>Activity report</h3>
    {!baselines.length && <p>Approve a project baseline to view the task report.</p>}
    {baselines.length > 0 && <p>Compare this activity with the approved schedule. Open source records to see the allocations and approved site hours behind the figures.</p>}
    {loading && <p role="status">Loading task report…</p>}
    {error && <p role="alert">{error}</p>}
    {baselines.length > 0 && report && <>
      <p>Approved baseline version {report.baselineVersion}.</p>
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
        {report.sources.baselineTask ? <p>Baseline version {report.baselineVersion} (source ID {report.baselineId}) · Activity {report.taskId} · Finish {day(report.sources.baselineTask.finishDate)}</p> : <p>Task absent from selected baseline.</p>}
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

function ProjectReports({ session, projectId, openTask, openPlanning, canManage, mode, baselineId, setBaselineId }) {
  const [baselines, setBaselines] = useState([])
  const [baselinesLoaded, setBaselinesLoaded] = useState(false)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const token = session.token

  useEffect(() => { if (mode === 'reports') setReport(null) }, [mode])

  useEffect(() => {
    setBaselines([])
    setBaselinesLoaded(false)
    setReport(null)
    if (!projectId) return
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setBaselines(result.baselines); setBaselinesLoaded(true); setError('') } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [projectId, token])

  async function loadReport(event) {
    event?.preventDefault()
    if (!baselines.length) return
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

  useEffect(() => {
    if (!projectId || mode !== 'overview' || !baselinesLoaded || !baselines.length) return
    const controller = new AbortController()
    const query = new URLSearchParams({ asOf })
    if (baselineId) query.set('baselineId', baselineId)
    call(`/reports/projects/${encodeURIComponent(projectId)}?${query}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setReport(result); setError('') } })
      .catch(err => { if (!controller.signal.aborted) { setReport(null); setError(err.message) } })
    return () => controller.abort()
  }, [projectId, baselineId, asOf, mode, token, baselinesLoaded, baselines.length])

  return <section>
    <p className="eyebrow">{mode === 'overview' ? 'Project overview' : 'Reporting'}</p>
    <h2>{mode === 'overview' ? 'Schedule and hours at a glance' : 'Project schedule and hours'}</h2>
    {baselinesLoaded && !baselines.length ? <div className="empty-state"><h3>No approved plan yet</h3>
      <p>Approve a project plan to see schedule and hours measures.</p>
      {canManage && <button type="button" onClick={openPlanning}>Open planning</button>}
    </div> : <form className="report-controls" onSubmit={loadReport}>
      <label>Approved baseline<select value={baselineId} onChange={event => { setBaselineId(event.target.value); setReport(null) }}>
        <option value="">Latest approved baseline</option>
        {baselines.map(row => <option key={row.id} value={row.id}>Version {row.versionNo} · {day(row.approvedAt)}</option>)}
      </select></label>
      <label>Report date<input type="date" value={asOf} onChange={event => { setAsOf(event.target.value); setReport(null) }} required /></label>
      {mode === 'reports' && <><label>Period start<input type="date" value={from} onChange={event => { setFrom(event.target.value); setReport(null) }} /></label>
      <label>Period end<input type="date" value={to} onChange={event => { setTo(event.target.value); setReport(null) }} /></label>
      <button>Show project report</button></>}
    </form>}
    {error && <p role="alert">{error}</p>}
    {mode === 'reports' && baselinesLoaded && baselines.length > 0 && !report && !error &&
      <p className="explanation">Choose the approved baseline and reporting dates, then show the project report.</p>}
    {report && <>
      <h3>{report.project.name} · baseline version {report.baseline.versionNo}</h3>
      <p>Report date {report.reportDate}. Hours period {report.from} to {report.to}.</p>
      <div className="metric-grid">
        <div className="metric"><span>Activities</span><strong>{report.totals.taskCount}</strong></div>
        <div className="metric metric-attention"><span>No progress report</span><strong>{report.tasks.filter(row => row.status === 'not_reported').length}</strong></div>
        <div className="metric"><span>Reported unfinished</span><strong>{report.totals.unfinished}</strong></div>
        <div className="metric"><span>Reported overdue</span><strong>{report.totals.overdue}</strong></div>
        <div className="metric"><span>Planned hours</span><strong>{report.totals.plannedHours}</strong></div>
        <div className="metric"><span>Approved recorded hours</span><strong>{report.totals.recordedHours ?? 'Not reported'}</strong></div>
      </div>
      <p className="explanation">Unfinished and overdue include activities with approved site updates. Activities without an update appear under “No progress report.” Planned hours come from allocations; recorded hours come from approved site updates.</p>
      <p className="explanation">The report uses records currently approved for the selected date. A later correction or withdrawal can change earlier figures.</p>
      {mode === 'overview' && <div className="overview-list"><h3>Activities needing attention</h3>
        <ul>{report.tasks.filter(row => row.overdue || row.status === 'not_reported').map(row => <li key={row.taskId}>
          <button type="button" className="text-button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button>
          <span>{row.overdue ? 'Overdue' : 'Not reported'}</span>
        </li>)}</ul>
        {!report.tasks.some(row => row.overdue || row.status === 'not_reported') && <p>No tasks need attention under these report rules.</p>}
      </div>}
      {mode === 'reports' && <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Baseline finish</th><th scope="col">Actual finish</th><th scope="col">Variance</th><th scope="col">Planned hours</th><th scope="col">Recorded hours</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{report.tasks.map(row => <tr key={row.taskId}>
          <th scope="row"><button type="button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button></th>
          <td>{row.status === 'not_reported' ? 'Not reported' : row.status}{row.overdue ? ' · Overdue' : ''}</td>
          <td>{day(row.baselineFinish) || 'New task'}</td><td>{day(row.actualFinish) || 'Not reported'}</td>
          <td>{row.finishVarianceDays == null ? 'Not available' : `${row.finishVarianceDays > 0 ? '+' : ''}${row.finishVarianceDays} days`}</td>
          <td>{row.plannedHours}</td><td>{row.recordedHours ?? 'Not reported'}</td>
          <td><details><summary>Source records</summary>
            <p>{row.sources.baselineId ? `Baseline version ${report.baseline.versionNo} (source ID ${row.sources.baselineId})` : 'Not in selected baseline'}; activity {row.taskId}</p>
            <ul>{row.sources.allocations.map(source => <li key={`a${source.id}`}>Allocation {source.id} · {day(source.workDate)} · {source.allocatedHours} hours</li>)}
              {row.sources.updates.map(source => <li key={`u${source.id}`}>Update {source.id} · allocation {source.allocationId} · {day(source.workDate)} · {source.recordedHours ?? 'No'} hours</li>)}</ul>
          </details></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>
}

function App() {
  const [session, setSession] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectTasks, setProjectTasks] = useState([])
  const [projectId, setProjectId] = useState('')
  const [section, setSection] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [planningPanel, setPlanningPanel] = useState('activity')
  const [reportBaselineId, setReportBaselineId] = useState('')
  const [projectsError, setProjectsError] = useState('')
  const [taskId, setTaskId] = useState('')
  const [visit, setVisit] = useState(0)
  const [taskListVersion, setTaskListVersion] = useState(0)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  useEffect(() => {
    if (!session) { setProjects([]); setProjectId(''); return }
    const controller = new AbortController()
    call('/projects', { token: session.token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setProjects(result.projects); setProjectId(result.projects[0]?.sharedId || ''); setTaskId(''); setProjectsError('') } })
      .catch(error => { if (!controller.signal.aborted) setProjectsError(error.message) })
    return () => controller.abort()
  }, [session])
  useEffect(() => {
    setProjectTasks([])
    if (!session || !projectId) return
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/tasks`, { token: session.token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setProjectTasks(result.tasks) })
      .catch(error => { if (!controller.signal.aborted) setProjectsError(error.message) })
    return () => controller.abort()
  }, [session, projectId, taskListVersion])
  const selectedProject = projects.find(project => project.sharedId === projectId)
  const canManage = selectedProject && ['ADMIN', 'PROJECT_MANAGER'].includes(selectedProject.role)
  const canSite = selectedProject && ['ADMIN', 'PROJECT_MANAGER', 'SITE_OFFICER'].includes(selectedProject.role)
  const sections = [
    ['overview', 'Overview'],
    ...(canManage ? [['planning', 'Planning'], ['workforce', 'Workforce']] : []),
    ...(canSite ? [['site', 'Site updates']] : []),
    ['reports', 'Reports']
  ]
  useEffect(() => { if (!sections.some(([key]) => key === section)) setSection('overview') }, [projectId, section, canManage, canSite])
  return <main className={session ? 'app-shell' : 'auth-shell'}>
    <header className="app-header"><div className="brand"><p className="eyebrow">Construction Workforce System</p><h1>CWS</h1></div>
      {session && <>
        {selectedProject && <button className="menu-toggle" type="button" aria-controls="main-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>{menuOpen ? 'Close menu' : 'Menu'}</button>}
        {selectedProject && <nav id="main-navigation" className={`workspace-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">{sections.map(([key, label]) => <button key={key} type="button"
          aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setMenuOpen(false) }}>{label}</button>)}</nav>}
        <div className="account"><span>{session.user.loginLabel}</span><button type="button" onClick={() => { setSession(null); setReportBaselineId(''); setTaskId(''); setSection('overview'); setMenuOpen(false) }}>Sign out</button></div>
      </>}
    </header>
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
      <p>Enter your account email to request a password reset.</p>
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
      {projectsError && <p role="alert">{projectsError}</p>}
      {projects.length > 0 && <div className="project-bar"><label className="project-switcher">Project<select value={projectId} onChange={event => { setProjectId(event.target.value); setReportBaselineId(''); setTaskId(''); setSection('overview'); setMenuOpen(false) }}>
        {projects.map(project => <option key={project.sharedId} value={project.sharedId}>{project.name} ({project.sharedId})</option>)}
      </select></label>{selectedProject && <p className="project-context">Your role: {selectedProject.role.replaceAll('_', ' ').toLowerCase()}</p>}</div>}
      {selectedProject && <>
      {section === 'planning' && canManage && <nav className="planning-nav" aria-label="Planning areas">
        {[['activity', 'Activities'], ['baseline', 'Approve schedule'], ['accounts', 'Project accounts']].map(([key, label]) =>
          <button key={key} type="button" aria-current={planningPanel === key ? 'page' : undefined}
            onClick={() => setPlanningPanel(key)}>{label}</button>)}
      </nav>}
      {((section === 'planning' && planningPanel === 'activity') || section === 'workforce' || section === 'site' || section === 'reports') &&
        <label className="task-switcher">Activity<select value={taskId} onChange={event => { setTaskId(event.target.value); setVisit(current => current + 1) }}>
          <option value="">Choose an activity</option>
          {projectTasks.map(task => <option key={task.id} value={task.sharedId || task.id}>{task.sharedId || task.taskCode} · {task.title}{task.status !== 'WORKING' ? ' (inactive)' : ''}</option>)}
        </select></label>}
      {(section === 'overview' || section === 'reports') && <ProjectReports key={projectId} session={session} projectId={projectId} mode={section}
        baselineId={reportBaselineId} setBaselineId={setReportBaselineId}
        canManage={canManage} openPlanning={() => { setPlanningPanel('baseline'); setSection('planning') }}
        openTask={id => { const task = projectTasks.find(row => row.id === Number(id) || row.sharedId === String(id)); setTaskId(String(task?.sharedId || id)); setVisit(current => current + 1); setSection(canSite && !canManage ? 'site' : 'reports') }} />}
      {section === 'planning' && planningPanel === 'baseline' && <ProjectBaselineApproval key={projectId} projectId={projectId}
        projectName={selectedProject.name} token={session.token} openOverview={() => setSection('overview')}
        onApproved={() => setTaskListVersion(current => current + 1)} />}
      {section === 'planning' && planningPanel === 'accounts' && <ProjectAccounts projectId={projectId} token={session.token} />}
      {section !== 'overview' && (section !== 'planning' || planningPanel === 'activity') && taskId &&
        <TaskWorkspace key={`${projectId}-${taskId}-${visit}`} taskId={taskId} session={session} section={section}
        reportBaselineId={reportBaselineId}
        onTasksChange={() => setTaskListVersion(current => current + 1)} openOverview={() => setSection('overview')}
        openWorkforce={() => setSection('workforce')} />}
      {section !== 'overview' && (section !== 'planning' || planningPanel === 'activity') && !taskId &&
        <p className="empty-state">Choose an activity to continue.</p>}
      {section === 'planning' && planningPanel === 'activity' && <ProjectTaskCreation projectId={projectId}
        token={session.token} onCreated={() => setTaskListVersion(current => current + 1)} />}
      </>}
    </>}
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
