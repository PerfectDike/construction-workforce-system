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

export function ActionForm({ children, button, busy, submitDisabled, resetOnSuccess = false, onSave, validate, onConflict, onChange }) {
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (pending || busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setError('')
    setMessage('')
    const errors = validate?.(values) || {}
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    setPending(true)
    try {
      const result = await onSave(values)
      if (resetOnSuccess) form.reset()
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

function PasswordInput({ label, name, autoComplete, minLength, required }) {
  const [visible, setVisible] = useState(false)
  return <label>{label}<div className="password-field">
    <input name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required={required} />
    <button type="button" className="eye-toggle" onClick={() => setVisible(v => !v)}
      aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <line x1="3" y1="3" x2="21" y2="21" />}
      </svg>
    </button>
  </div></label>
}

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

function validateNewTask(values) {
  const errors = {}
  const code = values.get('taskCode')?.trim().toUpperCase() || ''
  if (!/^T\d{3,}$/.test(code)) errors.taskCode = 'Use T followed by 3 or more digits (for example T107).'
  const start = values.get('newStartDate'), finish = values.get('newFinishDate')
  if (!values.get('newTitle')?.trim()) errors.newTitle = 'Enter an activity title.'
  if (!validDay(start)) errors.newStartDate = 'Enter a valid start date.'
  if (!validDay(finish)) errors.newFinishDate = 'Enter a valid finish date.'
  else if (validDay(start) && finish < start) errors.newFinishDate = 'Finish date must not precede start date.'
  else if (values.has('newMilestone') && validDay(start) && finish !== start) errors.newFinishDate = 'A milestone uses one date.'
  const ids = values.get('newPredecessors').split(',').map(id => id.trim().toUpperCase()).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.newPredecessors = 'List each predecessor once.'
  else if (code && ids.includes(code)) errors.newPredecessors = 'An activity cannot depend on itself.'
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

function Planning({ workflow, busy, mutate, openWorkforce, token }) {
  const { task, baselines, allocations, planHistory = [] } = workflow
  const [skills, setSkills] = useState([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    call(`/projects/${task.project.sharedId}/skills`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setSkills(result.skills); setSkillsLoaded(true) } }).catch(() => {})
    return () => controller.abort()
  }, [task.project.sharedId, token])
  const taskPath = `/tasks/${encodeURIComponent(task.sharedId ?? task.id)}`
  const [comparisonId, setComparisonId] = useState(String(baselines[0]?.id || ''))
  const [proposedStart, setProposedStart] = useState(day(task.startDate))
  const [proposedFinish, setProposedFinish] = useState(day(task.finishDate))
  const selectedBaseline = baselines.find(row => String(row.id) === comparisonId) || baselines[0]
  const affectedAllocations = allocations.filter(row => day(row.workDate) < proposedStart || day(row.workDate) > proposedFinish)
  return <section>
    <h3>Edit activity plan</h3>
    <p>{task.status === 'WORKING' ? 'Edit the working schedule below; approved baselines remain unchanged.' : 'This activity is inactive; approved baselines remain available.'}</p>
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
    <ActionForm button="Save plan" busy={busy} validate={values => validateWorkingPlan(values, task.sharedId ?? task.id)} onConflict={openWorkforce}
      onSave={async values => {
      await mutate(taskPath, 'PATCH', {
        title: values.get('title').trim(), startDate: values.get('startDate'), reason: values.get('planReason')?.trim(),
        finishDate: values.get('finishDate'), isMilestone: values.has('isMilestone'),
        predecessorIds: values.get('predecessors').split(',').map(id => id.trim()).filter(Boolean),
        ...(skillsLoaded ? { skillIds: values.getAll('skillIds').map(Number) } : {})
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
        <label><input name="isMilestone" type="checkbox" defaultChecked={task.isMilestone} /> Milestone (single date, no hours)</label>
        <label>Predecessors (e.g. T101, T102)<input name="predecessors" aria-invalid={!!errors.predecessors} aria-describedby={errors.predecessors ? 'plan-predecessors-error' : undefined}
          defaultValue={task.predecessors.map(({ predecessor }) => predecessor.sharedId ?? predecessor.id).join(', ')} /></label>
        <FieldError id="plan-predecessors-error" message={errors.predecessors} />
        <fieldset><legend>Required skills</legend>{skills.map(skill => <label key={skill.id}><input type="checkbox" name="skillIds" value={skill.id} defaultChecked={task.skills.some(row => row.skillId === skill.id)} /> {skill.name}</label>)}</fieldset>
        <label>Reason for revision (optional)<input name="planReason" /></label>
      </>}
    </ActionForm>
    {planHistory.length > 0 && <details className="action-panel"><summary>Working plan change history ({planHistory.length})</summary>
      <ul>{planHistory.map((event, index) => <li key={index}>{new Date(event.occurredAt).toLocaleString()} · {event.actor.loginLabel}
        {event.reason ? ` · ${event.reason}` : ''} · {planChangeSummary(event.fromState, event.toState)}</li>)}</ul>
    </details>}
    <details className="action-panel"><summary>Mark inactive</summary>
    <ActionForm button="Mark inactive" busy={busy} onSave={async values => {
      await mutate(`${taskPath}/inactivate`, 'POST', { reason: values.get('reason').trim() })
      return 'Activity marked inactive; history preserved.'
    }}>
      <label>Reason for inactivation (requires no active successors)<input name="reason" required /></label>
    </ActionForm></details>
    </>}
  </section>
}

function ProjectTaskCreation({ projectId, token, onCreated }) {
  const [skills, setSkills] = useState([])
  useEffect(() => {
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/skills`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSkills(result.skills) }).catch(() => {})
    return () => controller.abort()
  }, [projectId, token])
  return <section>
    <details className="action-panel"><summary>Add activity</summary>
      <p>New activities enter the working schedule for the next baseline.</p>
      <ActionForm button="Create activity" resetOnSuccess validate={validateNewTask} onSave={async values => {
        const saved = await call(`/projects/${encodeURIComponent(projectId)}/tasks`, { token, method: 'POST', data: {
          taskCode: values.get('taskCode').trim().toUpperCase(), title: values.get('newTitle').trim(),
          startDate: values.get('newStartDate'), finishDate: values.get('newFinishDate'),
          isMilestone: values.has('newMilestone'),
          predecessorIds: values.get('newPredecessors').split(',').map(id => id.trim()).filter(Boolean),
          skillIds: values.getAll('skillIds').map(Number)
        } })
        onCreated()
        return `Activity ${saved.sharedId} created. Select it from the activity list to review it.`
      }}>
        {errors => <>
          <label>Activity ID (e.g. T107)<input name="taskCode" placeholder="T107" pattern="T[0-9]{3,}" required aria-invalid={!!errors.taskCode} aria-describedby={errors.taskCode ? 'new-code-error' : undefined} /></label>
          <FieldError id="new-code-error" message={errors.taskCode} />
          <label>Activity title<input name="newTitle" required aria-invalid={!!errors.newTitle} aria-describedby={errors.newTitle ? 'new-title-error' : undefined} /></label>
          <FieldError id="new-title-error" message={errors.newTitle} />
          <label>Start date<input name="newStartDate" type="date" required aria-invalid={!!errors.newStartDate} aria-describedby={errors.newStartDate ? 'new-start-error' : undefined} /></label>
          <FieldError id="new-start-error" message={errors.newStartDate} />
          <label>Finish date<input name="newFinishDate" type="date" required aria-invalid={!!errors.newFinishDate} aria-describedby={errors.newFinishDate ? 'new-finish-error' : undefined} /></label>
          <FieldError id="new-finish-error" message={errors.newFinishDate} />
          <label><input name="newMilestone" type="checkbox" /> Milestone (single date, no hours)</label>
          <label>Predecessors (e.g. T101, T102)<input name="newPredecessors" aria-invalid={!!errors.newPredecessors} aria-describedby={errors.newPredecessors ? 'new-pred-error' : undefined} /></label>
          <FieldError id="new-pred-error" message={errors.newPredecessors} />
          <fieldset><legend>Required skills</legend>{skills.map(skill => <label key={skill.id}><input type="checkbox" name="skillIds" value={skill.id} /> {skill.name}</label>)}</fieldset>
        </>}
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
    <p>Review working activities for {projectName}. Approved baselines are locked snapshots.</p>
    {loaded && <p>{baselines.length ? `Latest approved baseline: version ${baselines[0].versionNo} (${day(baselines[0].approvedAt)}).` : 'This project has no approved baseline yet.'}</p>}
    <label>Approval reason {baselines.length ? '(required)' : '(optional)'}<input value={reason}
      onChange={event => { setReason(event.target.value); setPreview(null); setReviewError('') }} /></label>
    <button type="button" disabled={reviewBusy || !loaded} onClick={reviewBaseline}>Preview baseline</button>
    {reviewError && <p role="alert">{reviewError}</p>}
    {preview && <div className="baseline-preview" aria-label="Baseline review">
      <h3>Review project baseline version {preview.versionNo}</h3>
      <p>{preview.tasks.length} working activities will be saved. {preview.reason ? `Reason: ${preview.reason}` : 'Initial baseline approval.'}</p>
      <p className="scroll-hint">Scroll across the table to inspect every column.</p>
      <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Activity</th><th scope="col">Start</th><th scope="col">Finish</th><th scope="col">Milestone</th><th scope="col">Predecessors</th></tr></thead>
        <tbody>{preview.tasks.map(row => <tr key={row.id}>
          <th scope="row">{row.sharedId || row.taskCode} · {row.title}</th><td>{day(row.startDate)}</td><td>{day(row.finishDate)}</td>
          <td>{row.isMilestone ? 'Yes' : 'No'}</td><td>{row.predecessorIds.join(', ') || 'None'}</td>
        </tr>)}</tbody>
      </table></div>
      <p>The schedule is validated again when you approve it.</p>
      <ActionForm button="Approve baseline" onSave={async () => {
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

function ProjectAccounts({ projectId, token, isAdmin }) {
  const [memberships, setMemberships] = useState([])
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState('')
  const refresh = async () => {
    if (!isAdmin) return
    const [members, users] = await Promise.all([
      call(`/projects/${encodeURIComponent(projectId)}/memberships`, { token }),
      call('/setup/accounts', { token })
    ])
    setMemberships(members.memberships)
    setAccounts(users.accounts)
  }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [projectId, token, isAdmin])
  return <section>
    <h2>Project access</h2>
    <p>Invite a new <code>@example.test</code> account (saved to local test mail).</p>
    <ActionForm button="Invite project account" resetOnSuccess onSave={async values => {
      const created = await call(`/projects/${encodeURIComponent(projectId)}/accounts`, {
        token, method: 'POST', data: { loginLabel: values.get('loginLabel').trim(), roleName: values.get('roleName') }
      })
      await refresh()
      return `Invited ${created.loginLabel} as ${created.roleName.replaceAll('_', ' ').toLowerCase()}.`
    }}>
      <label>Account email (@example.test)<input name="loginLabel" type="email" placeholder="new.officer@example.test" required /></label>
      <label>Project role<select name="roleName" required>
        <option value="VIEWER">Viewer</option><option value="SITE_OFFICER">Site officer</option><option value="PROJECT_MANAGER">Project manager</option>
      </select></label>
    </ActionForm>
    {!isAdmin && <p className="explanation">Invited accounts receive project access; administrators manage existing memberships.</p>}
    {isAdmin && <>
      <h3>Assign existing account</h3>
      <p>Assign an existing fictional account to this project. Its current sign-in details stay the same.</p>
      {error && <p role="alert">{error}</p>}
      <ul>{memberships.map(row => <li key={row.id}>{row.loginLabel} · {row.roleName?.replaceAll('_', ' ').toLowerCase()}</li>)}</ul>
      <ActionForm button="Save role" onSave={async values => {
        const account = await call(`/projects/${encodeURIComponent(projectId)}/memberships/${values.get('userId')}`, { token, method: 'PUT', data: {
          roleName: values.get('roleName')
        } })
        await refresh()
        return `Project role saved: ${account.roleName.replaceAll('_', ' ').toLowerCase()}.`
      }}>
        <label>Account<select name="userId" required><option value="">Choose an account</option>
          {accounts.map(row => <option key={row.id} value={row.id}>{row.loginLabel}</option>)}
        </select></label>
        <label>Project role<select name="roleName" required>
          <option value="VIEWER">Viewer</option><option value="SITE_OFFICER">Site officer</option><option value="PROJECT_MANAGER">Project manager</option>
        </select></label>
      </ActionForm>
    </>}
  </section>
}

function AdminSetup({ token, onProjectCreated }) {
  const [skills, setSkills] = useState([])
  const [workers, setWorkers] = useState([])
  const [error, setError] = useState('')
  const refresh = async () => {
    const [skillResult, workerResult] = await Promise.all([call('/setup/skills', { token }), call('/setup/workers', { token })])
    setSkills(skillResult.skills)
    setWorkers(workerResult.workers)
  }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [token])
  return <section>
    <p className="eyebrow">Administrator</p><h2>Project and worker setup</h2>
    <p>Create fictional projects, skills, and workers (IDs are assigned automatically).</p>
    {error && <p role="alert">{error}</p>}
    <details className="action-panel"><summary>Create project</summary>
      <ActionForm button="Create project" resetOnSuccess onSave={async values => {
        const project = await call('/setup/projects', { token, method: 'POST', data: { name: values.get('name'), description: values.get('description') } })
        onProjectCreated(project)
        return `${project.sharedId} created. Add activities and assign project roles next.`
      }}>
        <label>Project name<input name="name" maxLength="160" required /></label>
        <label>Description<textarea name="description" maxLength="1000" /></label>
      </ActionForm>
    </details>
    <details className="action-panel"><summary>Add a skill</summary>
      <ActionForm button="Add skill" resetOnSuccess onSave={async values => {
        const skill = await call('/setup/skills', { token, method: 'POST', data: { name: values.get('name') } })
        await refresh()
        return `${skill.name} is available for workers and activities.`
      }}><label>Skill name<input name="name" maxLength="80" required /></label></ActionForm>
    </details>
    <details className="action-panel"><summary>Add a worker</summary>
      <ActionForm button="Create worker" resetOnSuccess onSave={async values => {
        const worker = await call('/setup/workers', { token, method: 'POST', data: { label: values.get('label'), dailyCapacityHours: Number(values.get('capacity')), skillIds: values.getAll('skillIds').map(Number) } })
        await refresh()
        return `${worker.sharedId} · ${worker.label} created.`
      }}>
        <label>Worker name<input name="label" maxLength="120" required /></label>
        <label>Daily capacity (0.01 to 24 hours)<input name="capacity" type="number" min="0.01" max="24" step="0.01" defaultValue="8" required /></label>
        <fieldset><legend>Skills</legend>{skills.map(skill => <label key={skill.id}><input type="checkbox" name="skillIds" value={skill.id} /> {skill.name}</label>)}</fieldset>
      </ActionForm>
    </details>
    <h3>Worker directory</h3>
    <p className="explanation">Capacity or skill edits flag affected allocations for review.</p>
    <div className="report-table-wrap"><table><thead><tr><th>ID</th><th>Worker</th><th>Daily capacity</th><th>Skills</th><th>Profile change</th></tr></thead><tbody>
      {workers.map(worker => <tr key={worker.sharedId}><th scope="row">{worker.sharedId}</th><td>{worker.label}</td><td>{worker.dailyCapacityHours} hours</td><td>{worker.skills.join(', ') || 'None'}</td><td>
        <details><summary>Edit</summary><ActionForm button="Save" onSave={async values => {
          const result = await call(`/setup/workers/${worker.sharedId}`, { token, method: 'PATCH', data: {
            label: values.get('label'), dailyCapacityHours: Number(values.get('capacity')),
            skillIds: values.getAll('skillIds').map(Number), reason: values.get('reason')
          } })
          await refresh()
          return result.impactedAllocations.length ? `${result.impactedAllocations.length} existing allocation(s) need review: ${result.impactedAllocations.map(row => row.allocationId).join(', ')}.` : 'Worker profile saved. No allocation needs review.'
        }}>
          <label>Name<input name="label" defaultValue={worker.label} required /></label>
          <label>Daily capacity<input name="capacity" type="number" min="0.01" max="24" step="0.01" defaultValue={worker.dailyCapacityHours} required /></label>
          <fieldset><legend>Skills</legend>{skills.map(skill => <label key={skill.id}><input type="checkbox" name="skillIds" value={skill.id} defaultChecked={worker.skillIds.includes(skill.id)} /> {skill.name}</label>)}</fieldset>
          <label>Reason for change<input name="reason" required /></label>
        </ActionForm></details>
      </td></tr>)}
    </tbody></table></div>
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
          <summary>Edit or cancel</summary>
          <ActionForm button="Save change" busy={busy} onSave={async values => {
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
            <label>Reason for allocation change<input name="reason" required /></label>
          </ActionForm>
          <ActionForm button="Cancel allocation" busy={busy} onSave={async values => {
            await mutate(`/allocations/${row.id}/cancel`, 'POST', { reason: values.get('reason').trim() })
            return 'Allocation cancelled.'
          }}>
            <label>Cancellation reason<input name="reason" required /></label>
          </ActionForm>
        </details>}
      </li>
    )}</ul> : <p className="empty-state">No workers allocated to this activity yet.</p>}
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
        <summary>Update worker availability</summary>
        <p>Declare how many hours a worker can work on a date (capped by their daily capacity; undeclared dates cannot be allocated).</p>
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
      <div className="allocation-form"><h4>New allocation</h4>
      <p>Approved activity window: {day(baselines[0].taskSnapshot?.startDate) || 'Not included'} to {day(baselines[0].taskSnapshot?.finishDate) || 'Not included'}. Remaining hours equal declared date availability (up to daily capacity) minus hours already allocated across all projects.</p>
      <ActionForm button="Allocate worker" busy={busy} submitDisabled={!selectedOption?.eligible || exceedsCapacity}
        onSave={async values => {
        await mutate('/allocations', 'POST', {
          workerId: values.get('workerId'), taskId: task.sharedId ?? task.id,
          workDate: values.get('workDate'), hours: Number(values.get('hours'))
        })
        setNewWorkerId('')
        setNewWorkDate('')
        setNewHours('')
        setOptions(null)
        return 'Worker allocated.'
      }}>
        <label>1. Allocation date<input name="workDate" type="date" value={newWorkDate}
          min={day(baselines[0].taskSnapshot?.startDate) || undefined}
          max={day(baselines[0].taskSnapshot?.finishDate) || undefined}
          onChange={event => { setNewWorkDate(event.target.value); setOptions(null); setOptionsError('') }} required /></label>
        {newWorkDate && <div className="allocation-check" role="status">
          {!options && !optionsError && <p>Checking worker skills and availability for {newWorkDate}…</p>}
          {optionsError && <p role="alert">{optionsError}</p>}
          {options && <>
            <div className="report-table-wrap"><table>
              <thead><tr><th scope="col">Worker</th><th scope="col">Available</th><th scope="col">Allocated</th><th scope="col">Remaining</th><th scope="col">Status</th><th scope="col">Select</th></tr></thead>
              <tbody>{options.workers.map(row => <tr key={row.workerId}>
                <th scope="row">{row.label} ({row.workerId})</th>
                <td>{row.availableHours == null ? 'Not declared' : `${row.availableHours} h`}</td>
                <td>{row.committedHours} h</td>
                <td>{row.remainingHours == null ? '0 h' : `${row.remainingHours} h`}</td>
                <td>{row.eligible ? 'Eligible' : row.flags.map(flag => optionMessages[flag] || flag).join('; ')}</td>
                <td><button type="button" disabled={!row.eligible} onClick={() => setNewWorkerId(row.workerId)}>{newWorkerId === row.workerId ? 'Selected' : 'Choose'}</button></td>
              </tr>)}</tbody>
            </table></div>
          </>}
          {selectedOption && exceedsCapacity && <p role="alert">Requested hours ({newHours} h) exceed {selectedOption.label}'s {selectedOption.remainingHours} h remaining on {newWorkDate}.</p>}
        </div>}
        <label>2. Worker<select name="workerId" value={newWorkerId} onChange={event => setNewWorkerId(event.target.value)} required>
          <option value="">Choose a worker</option>
          {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
        </select></label>
        <label>3. Allocation hours<input name="hours" type="number" min="0.01" step="0.01" value={newHours}
          onChange={event => setNewHours(event.target.value)} required /></label>
      </ActionForm>
      {(!selectedOption?.eligible || exceedsCapacity) && <p className="explanation">Select an eligible worker, approved date, and hours within remaining capacity.</p>}
      <p className="explanation">Cross-project capacity is re-checked on save.</p>
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
    <p>Submit hours against an approved allocation for manager review.</p>
    {updates.length ? <ul>{updates.map(update => <li key={update.id}>
      <p>Update {update.id} · Allocation {update.allocationId} · {day(update.workDate)} · {update.recordedHours == null ? 'Hours not reported' : `${update.recordedHours} hours`}
        {update.progressPercent != null && ` · ${update.progressPercent}% progress`}
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
    </li>)}</ul> : <p className="empty-state">No site updates submitted yet.</p>}
    {permissions.submitHours && (allocations.length ? <>
      <label>Site allocation<select value={allocationId} onChange={event => setAllocationId(event.target.value)} disabled={busy}>
        <option value="">Choose an allocation</option>
        {allocations.map(row => <option key={row.id} value={row.id}>
          Allocation {row.id} · {row.worker.label} · {day(row.workDate)}
        </option>)}
      </select></label>
      {selected && <ActionForm key={selected.id} button="Submit update" resetOnSuccess busy={busy} onSave={async values => {
        const correction = values.get('correction')
        const pct = values.get('progressPercent')
        await mutate('/site-updates', 'POST', {
          allocationId: selected.id, workDate: day(selected.workDate), recordedHours: Number(values.get('recordedHours')),
          progressPercent: pct !== '' && pct != null ? Number(pct) : undefined,
          actualFinishDate: values.get('actualFinishDate') || undefined, note: values.get('note').trim() || undefined,
          supersedesId: correction ? Number(correction) : undefined
        })
        setAllocationId('')
        return 'Site hours submitted for approval.'
      }}>
        {current.length > 0 && <label>Approved entry to replace<select name="correction" required>
          <option value="">Choose an approved update</option>
          {current.map(row => <option key={row.id} value={row.id}>Update {row.id} · {row.recordedHours} hours</option>)}
        </select></label>}
        <label>Recorded hours<input name="recordedHours" type="number" min="0" step="0.01" required /></label>
        <label>Progress % (optional, 0-100)<input name="progressPercent" type="number" min="0" max="100" step="1" /></label>
        <label>Actual finish date (optional)<input name="actualFinishDate" type="date" /></label>
        <label>Site note (optional)<textarea name="note" /></label>
      </ActionForm>}
    </> : <div className="next-step"><strong>No allocation yet</strong>
      <p>Awaiting a worker allocation from a project manager.</p>
    </div>)}
  </section>
}

function TaskWorkspace({ taskId, tasks = [], onSelectTask, session, section, reportBaselineId, onTasksChange, openOverview, openWorkforce }) {
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
      <div className="task-header">
        <div>
          <h2>{workflow.task.sharedId ?? workflow.task.taskCode} · {workflow.task.title}</h2>
          <p>{workflow.task.project.name} · Working dates {day(workflow.task.startDate)} to {day(workflow.task.finishDate)} · {workflow.task.status === 'WORKING' ? 'Working' : 'Inactive'}{workflow.task.isMilestone ? ' · Milestone' : ''}</p>
        </div>
        {tasks.length > 0 && (() => {
          const idx = tasks.findIndex(row => (row.sharedId || String(row.id)) === String(taskId))
          const prev = idx > 0 ? tasks[idx - 1] : null
          const next = idx >= 0 && idx < tasks.length - 1 ? tasks[idx + 1] : null
          return <div className="task-stepper">
            <button type="button" onClick={() => onSelectTask?.('')}>All activities</button>
            <button type="button" disabled={!prev} onClick={() => prev && onSelectTask?.(prev.sharedId || String(prev.id))}>Previous</button>
            <button type="button" disabled={!next} onClick={() => next && onSelectTask?.(next.sharedId || String(next.id))}>Next</button>
          </div>
        })()}
      </div>
      {section === 'planning' && workflow.permissions.plan && <Planning workflow={workflow} busy={busy} mutate={mutate} openWorkforce={openWorkforce} token={session.token} />}
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
    {baselines.length > 0 && <p>Compare against the approved baseline and inspect source records below.</p>}
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingUpdates, setPendingUpdates] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [csvNotice, setCsvNotice] = useState('')
  const token = session.token
  useEffect(() => {
    if (!canManage || mode !== 'overview') return
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/pending-updates`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPendingUpdates(result.updates) })
      .catch(() => { if (!controller.signal.aborted) setPendingUpdates([]) })
    return () => controller.abort()
  }, [projectId, token, canManage, mode])

  function downloadCsv() {
    if (!report) return
    const columns = ['Project ID', 'Baseline version', 'Report date', 'Period start', 'Period end', 'Activity ID', 'Activity', 'Status', 'Baseline finish', 'Actual finish', 'Finish variance days', 'Planned hours', 'Recorded hours', 'Baseline source ID', 'Allocation source IDs', 'Update source IDs']
    const safe = value => {
      const raw = value == null ? '' : String(value)
      const protectedText = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw
      return `"${protectedText.replaceAll('"', '""')}"`
    }
    const rows = report.tasks.map(row => [report.project.sharedId, report.baseline.versionNo, report.reportDate,
      report.from, report.to, row.taskId, row.title, row.status, day(row.baselineFinish), day(row.actualFinish),
      row.finishVarianceDays, row.plannedHours, row.recordedHours, row.sources.baselineId,
      row.sources.allocations.map(source => source.id).join('; '), row.sources.updates.map(source => source.id).join('; ')])
    const csv = [columns, ...rows].map(row => row.map(safe).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `CWS-${report.project.sharedId}-baseline-${report.baseline.versionNo}-${report.reportDate}.csv`
    link.click()
    setCsvNotice('CSV report downloaded.')
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

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
    setLoading(true)
    const query = new URLSearchParams({ asOf })
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (baselineId) query.set('baselineId', baselineId)
    try {
      setReport(await call(`/reports/projects/${encodeURIComponent(projectId)}?${query}`, { token }))
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!projectId || !baselinesLoaded || !baselines.length) return
    const controller = new AbortController()
    const query = new URLSearchParams({ asOf })
    if (mode === 'reports' && from) query.set('from', from)
    if (mode === 'reports' && to) query.set('to', to)
    if (baselineId) query.set('baselineId', baselineId)
    setLoading(true)
    call(`/reports/projects/${encodeURIComponent(projectId)}?${query}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setReport(result); setError('') } })
      .catch(err => { if (!controller.signal.aborted) { setReport(null); setError(err.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [projectId, baselineId, asOf, from, to, mode, token, baselinesLoaded, baselines.length])

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
      {mode === 'reports' && <><label>Period start (optional)<input type="date" value={from} onChange={event => { setFrom(event.target.value); setReport(null) }} /></label>
      <label>Period end (optional)<input type="date" value={to} onChange={event => { setTo(event.target.value); setReport(null) }} /></label>
      <button>Refresh report</button></>}
    </form>}
    {loading && <p role="status">Loading project report...</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <h3>{report.project.name} · baseline version {report.baseline.versionNo}</h3>
      <p>Report date {report.reportDate}. Hours period {report.from} to {report.to}.</p>
      {mode === 'reports' && <>
        <button type="button" onClick={downloadCsv}>Export CSV</button>
        {csvNotice && <p role="status">{csvNotice}</p>}
      </>}
      <div className="metric-grid">
        <div className="metric"><span>Activities</span><strong>{report.totals.taskCount}</strong></div>
        <div className="metric"><span>Reported finished</span><strong>{report.totals.finished ?? report.tasks.filter(row => row.status === 'finished').length}</strong></div>
        <div className="metric metric-attention"><span>No progress report</span><strong>{report.tasks.filter(row => row.status === 'not_reported').length}</strong></div>
        <div className="metric"><span>Reported unfinished</span><strong>{report.totals.unfinished}</strong></div>
        <div className="metric"><span>Reported overdue</span><strong>{report.totals.overdue}</strong></div>
        <div className="metric"><span>Planned hours</span><strong>{report.totals.plannedHours}</strong></div>
        <div className="metric"><span>Approved recorded hours</span><strong>{report.totals.recordedHours ?? 'Not reported'}</strong></div>
      </div>
      <p className="explanation">Figures reflect approved records as of the report date; unsubmitted tasks appear under "No progress report."</p>
      {mode === 'overview' && <div className="overview-list"><h3>Needs attention</h3>
        <ul>{report.tasks.filter(row => row.overdue || row.status === 'not_reported').map(row => <li key={row.taskId}>
          <button type="button" className="text-button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button>
          <span>{row.overdue ? 'Overdue' : 'Not reported'}</span>
        </li>)}</ul>
        {!report.tasks.some(row => row.overdue || row.status === 'not_reported') && <p>No activities need attention.</p>}
      </div>}
      {mode === 'overview' && canManage && <div className="overview-list"><h3>Pending approvals</h3>
        {pendingUpdates.length ? <ul>{pendingUpdates.map(row => <li key={row.id}>
          <button type="button" className="text-button" onClick={() => openTask(row.taskId, 'site')}>{row.taskId} · {row.title}</button>
          <span>Update {row.id} · {day(row.workDate)} · {row.author}</span>
        </li>)}</ul> : <p>No site updates are awaiting a decision.</p>}
      </div>}
      {mode === 'reports' && <>
        <div className="report-toolbar">
          <div className="report-filters" role="group" aria-label="Filter report tasks">
            {[['all', 'All'], ['finished', 'Finished'], ['unfinished', 'Unfinished'], ['overdue', 'Overdue'], ['not_reported', 'Not reported']].map(([key, label]) =>
              <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>{label}</button>
            )}
          </div>
          <label className="report-search"><input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search task ID or title" aria-label="Search report tasks" /></label>
        </div>
        {(() => {
          const q = searchQuery.trim().toLowerCase()
          const filteredTasks = report.tasks.filter(row => {
            const matchStatus = statusFilter === 'all' ? true : statusFilter === 'overdue' ? row.overdue : row.status === statusFilter
            const matchText = !q || row.taskId.toLowerCase().includes(q) || row.title.toLowerCase().includes(q)
            return matchStatus && matchText
          })
          const emptyByFilter = {
            finished: 'Nothing has finished yet. Completed updates will appear here.',
            unfinished: 'No unfinished activities reported yet.',
            overdue: 'No overdue activities as of this report date.',
            not_reported: 'All activities have a progress report.',
            all: 'No activities in this project yet.'
          }
          if (!filteredTasks.length) {
            return <p className="empty-state">{q ? `No activities match "${searchQuery.trim()}".` : emptyByFilter[statusFilter]}</p>
          }
          return <div className="report-table-wrap"><table>
            <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Baseline finish</th><th scope="col">Actual finish</th><th scope="col">Variance</th><th scope="col">Planned hours</th><th scope="col">Recorded hours</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{filteredTasks.map(row => <tr key={row.taskId}>
              <th scope="row"><button type="button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button></th>
              <td>{row.status === 'not_reported' ? 'Not reported' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}{row.overdue ? ' · Overdue' : ''}</td>
              <td>{day(row.baselineFinish) || 'Not in baseline (new)'}</td><td>{day(row.actualFinish) || 'Not reported'}</td>
              <td>{row.finishVarianceDays == null ? 'Not available' : `${row.finishVarianceDays > 0 ? '+' : ''}${row.finishVarianceDays} days`}</td>
              <td>{row.plannedHours}</td><td>{row.recordedHours ?? 'Not reported'}</td>
              <td><details><summary>Source records</summary>
                <p>{row.sources.baselineId ? `Baseline version ${report.baseline.versionNo} (source ID ${row.sources.baselineId})` : 'Not in selected baseline'}; activity {row.taskId}</p>
                <ul>{row.sources.allocations.map(source => <li key={`a${source.id}`}>Allocation {source.id} · {day(source.workDate)} · {source.allocatedHours} hours</li>)}
                  {row.sources.updates.map(source => <li key={`u${source.id}`}>Update {source.id} · allocation {source.allocationId} · {day(source.workDate)} · {source.recordedHours == null ? 'Hours not reported' : `${source.recordedHours} hours`}</li>)}</ul>
              </details></td>
            </tr>)}</tbody>
          </table></div>
        })()}</>}
    </>}
  </section>
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('cws-session') || 'null')
      const payload = saved?.token && JSON.parse(atob(saved.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload?.exp * 1000 > Date.now() ? saved : null
    } catch { return null }
  })
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
    if (session) sessionStorage.setItem('cws-session', JSON.stringify(session))
    else sessionStorage.removeItem('cws-session')
  }, [session])
  useEffect(() => {
    if (!session) return
    let expiry = 0
    try { expiry = JSON.parse(atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 } catch { setSession(null); return }
    const timer = setTimeout(() => setSession(null), Math.max(0, expiry - Date.now()))
    return () => clearTimeout(timer)
  }, [session])
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
  const isAdmin = session?.user.role === 'ADMIN'
  const sections = [
    ...(isAdmin ? [['setup', 'Setup']] : []),
    ['overview', 'Overview'],
    ...(canManage ? [['planning', 'Planning'], ['workforce', 'Workforce']] : []),
    ...(canSite ? [['site', 'Site updates']] : []),
    ['reports', 'Reports']
  ]
  useEffect(() => { if (!sections.some(([key]) => key === section)) setSection(isAdmin ? 'setup' : 'overview') }, [projectId, section, canManage, canSite, isAdmin])
  const signOut = () => { setSession(null); setReportBaselineId(''); setTaskId(''); setSection('overview'); setMenuOpen(false) }
  const shell = <main className={session ? 'app-shell' : 'auth-shell'}>
    <header className="app-header"><div className="brand"><h1>CWS</h1></div>
      {session && <>
        <button className="menu-toggle" type="button" aria-controls="main-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMenuOpen(open => !open)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {menuOpen ? <><line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" /></>
              : <><line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" /></>}
          </svg>
        </button>
        <nav id="main-navigation" className={`workspace-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          {(selectedProject || isAdmin) && sections.map(([key, label]) => <button key={key} type="button"
            aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setMenuOpen(false) }}>{label}</button>)}
          <button type="button" className="nav-signout" onClick={signOut}>Sign out</button>
        </nav>
        <div className="account"><span>{session.user.loginLabel}</span><button type="button" onClick={signOut}>Sign out</button></div>
      </>}
    </header>
    {!session && resetToken ? <>
      <h2>Reset password</h2>
      <ActionForm button="Save password" onSave={async values => {
        const result = await call('/auth/recovery/reset', {
          method: 'POST', data: { token: resetToken, newPassword: values.get('newPassword') }
        })
        window.history.replaceState({}, '', window.location.pathname)
        setResetToken('')
        setRecoveryMessage(result.message)
        return result.message
      }}>
        <PasswordInput label="New password (at least 12 characters)" name="newPassword" autoComplete="new-password" minLength="12" required />
      </ActionForm>
      <button type="button" onClick={() => { window.history.replaceState({}, '', window.location.pathname); setResetToken('') }}>Back to sign in</button>
    </> : !session && recoveryMode ? <>
      <h2>Recover account</h2>
      <p>Enter your email to request a reset link (saved to local test mail).</p>
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
        const signedIn = await call('/auth/login', {
          method: 'POST', data: { loginLabel: values.get('email'), password: values.get('password') }
        })
        setSession(signedIn)
        setSection(signedIn.user.role === 'ADMIN' ? 'setup' : 'overview')
      }}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <PasswordInput label="Password" name="password" autoComplete="current-password" required />
      </ActionForm>
      <button type="button" onClick={() => setRecoveryMode(true)}>Forgot password?</button>
    </> : <>
      {projectsError && <p role="alert">{projectsError}</p>}
      {projects.length > 0 && <div className="project-bar"><label className="project-switcher">Project<select value={projectId} onChange={event => { setProjectId(event.target.value); setReportBaselineId(''); setTaskId(''); setPlanningPanel('activity'); setSection('overview'); setMenuOpen(false) }}>
        {projects.map(project => <option key={project.sharedId} value={project.sharedId}>{project.name} ({project.sharedId})</option>)}
      </select></label>{selectedProject && <p className="project-context">Your role: {selectedProject.role.replaceAll('_', ' ').toLowerCase()}</p>}</div>}
      {selectedProject && <>
      {section === 'planning' && canManage && <nav className="planning-nav" aria-label="Planning areas">
        {[['activity', 'Activities'], ['baseline', 'Approve schedule'], ['accounts', 'Project access']].map(([key, label]) =>
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
        openTask={(id, targetSection) => { const task = projectTasks.find(row => row.id === Number(id) || row.sharedId === String(id)); setTaskId(String(task?.sharedId || id)); setVisit(current => current + 1); setSection(targetSection || (canSite && !canManage ? 'site' : 'reports')) }} />}
      {section === 'planning' && planningPanel === 'baseline' && <ProjectBaselineApproval key={projectId} projectId={projectId}
        projectName={selectedProject.name} token={session.token} openOverview={() => setSection('overview')}
        onApproved={() => setTaskListVersion(current => current + 1)} />}
      {section === 'planning' && planningPanel === 'accounts' && <ProjectAccounts projectId={projectId} token={session.token} isAdmin={isAdmin} />}
      {section !== 'overview' && (section !== 'planning' || planningPanel === 'activity') && taskId &&
        <TaskWorkspace key={`${projectId}-${taskId}-${visit}`} taskId={taskId} tasks={projectTasks}
        onSelectTask={id => { setTaskId(id); setVisit(current => current + 1) }}
        session={session} section={section} reportBaselineId={reportBaselineId}
        onTasksChange={() => setTaskListVersion(current => current + 1)} openOverview={() => setSection('overview')}
        openWorkforce={() => setSection('workforce')} />}
      {section !== 'overview' && section !== 'reports' && (section !== 'planning' || planningPanel === 'activity') && !taskId && (
        projectTasks.length > 0 ? <section>
          <h3>Project activities ({projectTasks.length})</h3>
          <p className="explanation">Select an activity below to open its details.</p>
          <div className="report-table-wrap"><table>
            <thead><tr><th scope="col">ID</th><th scope="col">Activity</th><th scope="col">Working dates</th><th scope="col">Predecessors</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
            <tbody>{projectTasks.map(task => <tr key={task.id}>
              <th scope="row">{task.sharedId || task.taskCode}</th>
              <td>{task.title}{task.isMilestone ? ' (Milestone)' : ''}</td>
              <td>{day(task.startDate)} to {day(task.finishDate)}</td>
              <td>{task.predecessorIds?.join(', ') || 'None'}</td>
              <td>{task.status === 'WORKING' ? 'Working' : 'Inactive'}</td>
              <td><button type="button" onClick={() => { setTaskId(task.sharedId || String(task.id)); setVisit(current => current + 1) }}>Open</button></td>
            </tr>)}</tbody>
          </table></div>
        </section> : <p className="empty-state">No activities in this project yet.</p>
      )}
      {section === 'planning' && planningPanel === 'activity' && <ProjectTaskCreation projectId={projectId}
        token={session.token} onCreated={() => setTaskListVersion(current => current + 1)} />}
      </>}
      {isAdmin && section === 'setup' && <AdminSetup token={session.token} onProjectCreated={project => {
        setProjects(current => [...current, { ...project, role: 'ADMIN' }])
        setProjectId(project.sharedId)
      }} />}
    </>}
  </main>
  return session ? shell : <div className="auth-page">{shell}</div>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
