import React, { useEffect, useState } from 'react'
import { call, day, formatRoleLabel, planChangeSummary, validateNewTask, validateWorkingPlan } from '../api.js'
import { ActionForm, ExpandableText, FieldError, Icon, SkeletonLines, Spinner, StatusBadge, StatusBanner } from './UiPrimitives.jsx'

export function Planning({ workflow, busy, mutate, openWorkforce, token }) {
  const { task, baselines, allocations, planHistory = [] } = workflow
  const [skills, setSkills] = useState([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [skillsError, setSkillsError] = useState('')
  const [skillsRetry, setSkillsRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setSkillsError('')
    call(`/projects/${encodeURIComponent(task.project.sharedId || task.project.id)}/skills`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setSkills(result.skills); setSkillsLoaded(true) } })
      .catch(err => { if (!controller.signal.aborted) setSkillsError(err.message) })
    return () => controller.abort()
  }, [task.project.sharedId, task.project.id, token, skillsRetry])

  const taskPath = `/tasks/${encodeURIComponent(task.sharedId ?? task.id)}`
  const [comparisonId, setComparisonId] = useState(String(baselines[0]?.id || ''))
  const [proposedStart, setProposedStart] = useState(day(task.startDate))
  const [proposedFinish, setProposedFinish] = useState(day(task.finishDate))

  useEffect(() => {
    setProposedStart(day(task.startDate))
    setProposedFinish(day(task.finishDate))
  }, [task.id, task.startDate, task.finishDate])

  useEffect(() => {
    if (baselines.length && !baselines.some(row => String(row.id) === comparisonId)) {
      setComparisonId(String(baselines[0].id))
    }
  }, [baselines, comparisonId])

  const selectedBaseline = baselines.find(row => String(row.id) === comparisonId) || baselines[0]
  const affectedAllocations = allocations.filter(row => day(row.workDate) < proposedStart || day(row.workDate) > proposedFinish)

  return <section>
    <h3>Edit activity plan</h3>
    <p>{task.status === 'WORKING'
      ? 'Edit the working schedule below; approved baselines remain unchanged.'
      : 'This activity is inactive; approved baselines remain available.'}</p>

    {baselines.length > 0 && <div className="plan-comparison">
      <label>Compare with approved schedule<select value={selectedBaseline?.id || ''} onChange={event => setComparisonId(event.target.value)}>
        {baselines.map(row => <option key={row.id} value={row.id}>Version {row.versionNo} · {day(row.approvedAt)}</option>)}
      </select></label>
      {selectedBaseline?.taskSnapshot ? <div className="report-table-wrap"><table>
        <thead><tr><th scope="col">Plan</th><th scope="col">Start</th><th scope="col">Finish</th><th scope="col">Predecessors</th></tr></thead>
        <tbody>
          <tr>
            <th scope="row">Approved version {selectedBaseline.versionNo}</th>
            <td data-label="Start" className="nowrap">{day(selectedBaseline.taskSnapshot.startDate)}</td>
            <td data-label="Finish" className="nowrap">{day(selectedBaseline.taskSnapshot.finishDate)}</td>
            <td data-label="Predecessors"><ExpandableText text={selectedBaseline.predecessorIds.join(', ')} fallback="None" /></td>
          </tr>
          <tr>
            <th scope="row">Saved working plan</th>
            <td data-label="Start" className="nowrap">{day(task.startDate)}</td>
            <td data-label="Finish" className="nowrap">{day(task.finishDate)}</td>
            <td data-label="Predecessors"><ExpandableText text={task.predecessors.map(edge => edge.predecessor.sharedId || edge.predecessor.id).join(', ')} fallback="None" /></td>
          </tr>
        </tbody>
      </table></div> : <p>This activity is new since the selected baseline.</p>}
      {selectedBaseline?.reason && <p>Approval reason: <ExpandableText text={selectedBaseline.reason} /></p>}
    </div>}

    {allocations.length > 0 && <div className="allocation-impact">
      <h4>Saved worker assignments ({allocations.length})</h4>
      <p>Changing activity dates does not move worker assignments. Review their saved work dates before changing the plan.</p>
      <ul>{allocations.map(row => <li key={row.id}>Allocation #{row.id}: {row.worker.label} · {day(row.workDate)} · {row.allocatedHours} hours</li>)}</ul>
      {affectedAllocations.length > 0 && <StatusBanner kind="info"
        message={`The proposed dates exclude ${affectedAllocations.length} saved assignment(s).`}
        actionLabel="Open workforce" onAction={openWorkforce} />}
    </div>}

    {task.status === 'WORKING' ? <>
      {skillsError && <StatusBanner kind="error" message={`Could not load project skills: ${skillsError}`} actionLabel="Retry" onAction={() => setSkillsRetry(n => n + 1)} />}
      <ActionForm button="Save plan" icon="check" busy={busy} validate={values => validateWorkingPlan(values, task.sharedId ?? task.id)} onConflict={openWorkforce}
        onSave={async values => {
          await mutate(taskPath, 'PATCH', {
            title: values.get('title').trim(),
            startDate: values.get('startDate'),
            reason: values.get('planReason')?.trim(),
            finishDate: values.get('finishDate'),
            isMilestone: values.has('isMilestone'),
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
          <label className="checkbox-option"><input name="isMilestone" type="checkbox" defaultChecked={task.isMilestone} /> <span>Milestone <span className="field-hint">(single date, no hours)</span></span></label>
          <label>Predecessors <span className="field-hint">(comma-separated, e.g. T101, T102)</span><input name="predecessors" aria-invalid={!!errors.predecessors} aria-describedby={errors.predecessors ? 'plan-predecessors-error' : undefined}
            defaultValue={task.predecessors.map(({ predecessor }) => predecessor.sharedId ?? predecessor.id).join(', ')} /></label>
          <FieldError id="plan-predecessors-error" message={errors.predecessors} />
          <fieldset className="skills-fieldset"><legend>Required skills</legend>
            {!skillsLoaded && !skillsError ? <SkeletonLines count={2} label="Loading skills" />
              : skills.length ? <div className="checkbox-grid">
                {skills.map(skill => <label key={skill.id} className="checkbox-option"><input type="checkbox" name="skillIds" value={skill.id} defaultChecked={task.skills.some(row => row.skillId === skill.id)} /> <span>{skill.name}</span></label>)}
              </div> : <p className="explanation">No skills configured yet.</p>}
          </fieldset>
          <label>Reason for revision <span className="field-hint">(optional)</span><input name="planReason" /></label>
        </>}
      </ActionForm>

      {planHistory.length > 0 && <details className="action-panel"><summary>Working plan change history ({planHistory.length})</summary>
        <ul>{planHistory.map((event, index) => <li key={index}>
          {new Date(event.occurredAt).toLocaleString()} · {event.actor.loginLabel}
          {event.reason ? ` · ${event.reason}` : ''} · {planChangeSummary(event.fromState, event.toState)}
        </li>)}</ul>
      </details>}

      <details className="action-panel"><summary>Mark inactive</summary>
        <ActionForm button="Mark inactive" icon="x" busy={busy} onSave={async values => {
          await mutate(`${taskPath}/inactivate`, 'POST', { reason: values.get('reason').trim() })
          return 'Activity marked inactive; history preserved.'
        }}>
          <label>Reason for inactivation <span className="field-hint">(requires no active successors)</span><input name="reason" required /></label>
        </ActionForm>
      </details>
    </> : <details className="action-panel" open><summary>Reactivate activity</summary>
      <ActionForm button="Reactivate activity" icon="refresh" busy={busy} onSave={async values => {
        await mutate(`${taskPath}/reactivate`, 'POST', { reason: values.get('reason').trim() })
        return 'Activity restored to working status.'
      }}>
        <label>Reason for reactivation<input name="reason" required /></label>
      </ActionForm>
    </details>}
  </section>
}

export function ProjectTaskCreation({ projectId, token, onCreated }) {
  const [skills, setSkills] = useState([])
  const [skillsError, setSkillsError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setSkillsError('')
    call(`/projects/${encodeURIComponent(projectId)}/skills`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSkills(result.skills) })
      .catch(err => { if (!controller.signal.aborted) setSkillsError(err.message) })
    return () => controller.abort()
  }, [projectId, token])

  return <section>
    <details className="action-panel"><summary>Add activity</summary>
      <p>New activities enter the working schedule for the next baseline.</p>
      {skillsError && <StatusBanner kind="error" message={`Could not load skills: ${skillsError}`} />}
      <ActionForm button="Create activity" icon="plus" resetOnSuccess validate={validateNewTask} onSave={async values => {
        const saved = await call(`/projects/${encodeURIComponent(projectId)}/tasks`, {
          token,
          method: 'POST',
          data: {
            taskCode: values.get('taskCode').trim().toUpperCase(),
            title: values.get('newTitle').trim(),
            startDate: values.get('newStartDate'),
            finishDate: values.get('newFinishDate'),
            isMilestone: values.has('newMilestone'),
            predecessorIds: values.get('newPredecessors').split(',').map(id => id.trim()).filter(Boolean),
            skillIds: values.getAll('skillIds').map(Number)
          }
        })
        onCreated()
        return `Activity ${saved.sharedId} created. Select it from the activity list to review it.`
      }}>
        {errors => <>
          <label>Activity ID <span className="field-hint">(e.g. T107)</span><input name="taskCode" placeholder="T107" pattern="T[0-9]{3,}" required aria-invalid={!!errors.taskCode} aria-describedby={errors.taskCode ? 'new-code-error' : undefined} /></label>
          <FieldError id="new-code-error" message={errors.taskCode} />
          <label>Activity title<input name="newTitle" required aria-invalid={!!errors.newTitle} aria-describedby={errors.newTitle ? 'new-title-error' : undefined} /></label>
          <FieldError id="new-title-error" message={errors.newTitle} />
          <label>Start date<input name="newStartDate" type="date" required aria-invalid={!!errors.newStartDate} aria-describedby={errors.newStartDate ? 'new-start-error' : undefined} /></label>
          <FieldError id="new-start-error" message={errors.newStartDate} />
          <label>Finish date<input name="newFinishDate" type="date" required aria-invalid={!!errors.newFinishDate} aria-describedby={errors.newFinishDate ? 'new-finish-error' : undefined} /></label>
          <FieldError id="new-finish-error" message={errors.newFinishDate} />
          <label className="checkbox-option"><input name="newMilestone" type="checkbox" /> <span>Milestone <span className="field-hint">(single date, no hours)</span></span></label>
          <label>Predecessors <span className="field-hint">(comma-separated, e.g. T101, T102)</span><input name="newPredecessors" aria-invalid={!!errors.newPredecessors} aria-describedby={errors.newPredecessors ? 'new-pred-error' : undefined} /></label>
          <FieldError id="new-pred-error" message={errors.newPredecessors} />
          <fieldset className="skills-fieldset"><legend>Required skills</legend>
            {skills.length ? <div className="checkbox-grid">
              {skills.map(skill => <label key={skill.id} className="checkbox-option"><input type="checkbox" name="skillIds" value={skill.id} /> <span>{skill.name}</span></label>)}
            </div> : <p className="explanation">No skills configured yet.</p>}
          </fieldset>
        </>}
      </ActionForm>
    </details>
  </section>
}

export function ProjectBaselineApproval({ projectId, projectName, token, openOverview, onApproved }) {
  const [baselines, setBaselines] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [approved, setApproved] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoaded(false)
    setReviewError('')
    call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setBaselines(result.baselines); setLoaded(true) } })
      .catch(error => { if (!controller.signal.aborted) { setReviewError(error.message); setLoaded(true) } })
    return () => controller.abort()
  }, [projectId, token, reloadTick])

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
    } catch (error) {
      setReviewError(error.message)
    } finally {
      setReviewBusy(false)
    }
  }

  return <section>
    <p className="eyebrow">Project-wide action</p>
    <h2>Approve project schedule</h2>
    <p>Review working activities for {projectName}. Approved baselines are locked snapshots.</p>
    {!loaded ? <SkeletonLines count={2} label="Loading schedule baseline status" />
      : <p>{baselines.length ? `Latest approved baseline: version ${baselines[0].versionNo} (${day(baselines[0].approvedAt)}).` : 'This project has no approved baseline yet.'}</p>}
    <label>Approval reason <span className="field-hint">{baselines.length ? '(required)' : '(optional)'}</span><input value={reason}
      onChange={event => { setReason(event.target.value); setPreview(null); setReviewError('') }} /></label>
    <button type="button" disabled={reviewBusy || !loaded} aria-busy={reviewBusy} onClick={reviewBaseline}>
      {reviewBusy ? <Spinner /> : <Icon name="list" />}{reviewBusy ? 'Loading preview...' : 'Preview baseline'}
    </button>
    {reviewError && <StatusBanner kind="error" message={reviewError} actionLabel="Retry" onAction={() => setReloadTick(n => n + 1)} onDismiss={() => setReviewError('')} />}
    {preview && <div className="baseline-preview" aria-label="Baseline review">
      <h3>Review project baseline version {preview.versionNo}</h3>
      <p>{preview.tasks.length} working activities will be saved. {preview.reason ? `Reason: ${preview.reason}` : 'Initial baseline approval.'}</p>
      <p className="scroll-hint">Swipe across the table to inspect every column.</p>
      <div className="report-table-wrap"><table>
        <thead><tr><th scope="col" className="sticky-col">Activity</th><th scope="col">Start</th><th scope="col">Finish</th><th scope="col">Predecessors</th></tr></thead>
        <tbody>{preview.tasks.map(row => <tr key={row.id}>
          <th scope="row" className="sticky-col">{row.sharedId || row.taskCode} · <ExpandableText text={row.title} limit={70} /></th>
          <td className="nowrap">{day(row.startDate)}</td>
          <td className="nowrap">{day(row.finishDate)}</td>
          <td><ExpandableText text={row.predecessorIds.join(', ')} fallback="None" /></td>
        </tr>)}</tbody>
      </table></div>
      <p>The schedule is validated again when you approve it.</p>
      <ActionForm button="Approve baseline" icon="check" onSave={async () => {
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

export function ProjectAccounts({ projectId, token, isAdmin, mailConfigured = true, openSetup }) {
  const [memberships, setMemberships] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!isAdmin) return
    setLoading(true)
    setError('')
    try {
      const [members, users] = await Promise.all([
        call(`/projects/${encodeURIComponent(projectId)}/memberships`, { token }),
        call('/setup/accounts', { token })
      ])
      setMemberships(members.memberships)
      setAccounts(users.accounts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [projectId, token, isAdmin])

  return <section>
    <h2>Project access</h2>
    {mailConfigured ? <>
      <p>Invite a new project account and assign its role for this project.</p>
      <ActionForm button="Invite project account" icon="userPlus" resetOnSuccess onSave={async values => {
        const created = await call(`/projects/${encodeURIComponent(projectId)}/accounts`, {
          token, method: 'POST', data: { loginLabel: values.get('loginLabel').trim(), roleName: values.get('roleName') }
        })
        await refresh()
        return `Invited ${created.loginLabel} as ${formatRoleLabel(created.roleName).toLowerCase()}.`
      }}>
        <label>Account email <span className="field-hint">(@example.test)</span><input name="loginLabel" type="email" placeholder="new.officer@example.test" required /></label>
        <label>Project role<select name="roleName" required>
          <option value="VIEWER">Viewer</option><option value="SITE_OFFICER">Site officer</option><option value="PROJECT_MANAGER">Project manager</option>
        </select></label>
      </ActionForm>
    </> : <StatusBanner kind="info"
      message={isAdmin
        ? 'Email invitation links are disabled in this live environment. Create or reset accounts directly in Setup, then assign their project role below.'
        : 'Email invitations are not configured in this live environment. Contact an administrator to provision a new account or update project membership.'}
      actionLabel={isAdmin && openSetup ? 'Open Setup' : undefined}
      onAction={isAdmin ? openSetup : undefined} />}

    {!isAdmin && mailConfigured && <p className="explanation">Invited accounts receive project access; administrators manage existing memberships.</p>}

    {isAdmin && <>
      <h3>Current memberships ({memberships.length}) &amp; role assignment</h3>
      <p>Assign an existing account to this project. Its current sign-in credentials stay the same.</p>
      {error && <StatusBanner kind="error" message={error} actionLabel="Retry" onAction={refresh} />}
      {loading && !memberships.length ? <SkeletonLines count={3} label="Loading project memberships" />
        : memberships.length > 0 && <div className="report-table-wrap"><table className="stack-mobile">
          <thead><tr><th scope="col">Account</th><th scope="col">Project role</th></tr></thead>
          <tbody>{memberships.map(row => <tr key={row.id}>
            <th scope="row">{row.loginLabel}</th>
            <td data-label="Project role"><StatusBadge tone={row.roleName === 'ADMIN' || row.roleName === 'PROJECT_MANAGER' ? 'brand' : 'muted'}>{formatRoleLabel(row.roleName)}</StatusBadge></td>
          </tr>)}</tbody>
        </table></div>}
      <ActionForm button="Save role" icon="check" onSave={async values => {
        const account = await call(`/projects/${encodeURIComponent(projectId)}/memberships/${values.get('userId')}`, {
          token, method: 'PUT', data: { roleName: values.get('roleName') }
        })
        await refresh()
        return `Project role saved: ${formatRoleLabel(account.roleName).toLowerCase()}.`
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
