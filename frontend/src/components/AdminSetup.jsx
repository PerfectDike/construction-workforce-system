import React, { useEffect, useState } from 'react'
import { call, formatRoleLabel } from '../api.js'
import { ActionForm, ExpandableText, PaginationBar, StatusBadge, StatusBanner, TableSkeleton, usePagination } from './UiPrimitives.jsx'

export function AdminSetup({ token, projects = [], onProjectCreated }) {
  const [skills, setSkills] = useState([])
  const [workers, setWorkers] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tempCredentialNotice, setTempCredentialNotice] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [skillResult, workerResult, accountResult] = await Promise.all([
        call('/setup/skills', { token }),
        call('/setup/workers', { token }),
        call('/setup/accounts', { token })
      ])
      setSkills(skillResult.skills)
      setWorkers(workerResult.workers)
      setAccounts(accountResult.accounts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [token])

  const workerPager = usePagination(workers, 25)
  const accountPager = usePagination(accounts, 25)

  return <section>
    <p className="eyebrow">Administrator</p>
    <h2>Project, worker &amp; account setup</h2>
    <p>Create projects, skills, workers, and user accounts (IDs are assigned automatically).</p>
    {error && <StatusBanner kind="error" message={error} actionLabel="Retry" onAction={refresh} />}
    {tempCredentialNotice && <StatusBanner kind="success" message={tempCredentialNotice} onDismiss={() => setTempCredentialNotice('')} />}

    <details className="action-panel"><summary>Create project</summary>
      <ActionForm button="Create project" icon="plus" resetOnSuccess onSave={async values => {
        const project = await call('/setup/projects', {
          token, method: 'POST', data: { name: values.get('name'), description: values.get('description') }
        })
        onProjectCreated(project)
        return `${project.sharedId} created. Add activities and assign project roles next.`
      }}>
        <label>Project name<input name="name" maxLength="160" required /></label>
        <label>Description <span className="field-hint">(optional)</span><textarea name="description" maxLength="1000" /></label>
      </ActionForm>
    </details>

    <details className="action-panel"><summary>Add a skill</summary>
      <ActionForm button="Add skill" icon="plus" resetOnSuccess onSave={async values => {
        const skill = await call('/setup/skills', { token, method: 'POST', data: { name: values.get('name') } })
        await refresh()
        return `${skill.name} is available for workers and activities.`
      }}><label>Skill name<input name="name" maxLength="80" required /></label></ActionForm>
    </details>

    <details className="action-panel"><summary>Add a worker</summary>
      <ActionForm button="Create worker" icon="userPlus" resetOnSuccess onSave={async values => {
        const worker = await call('/setup/workers', {
          token, method: 'POST', data: {
            label: values.get('label'),
            dailyCapacityHours: Number(values.get('capacity')),
            skillIds: values.getAll('skillIds').map(Number)
          }
        })
        await refresh()
        return `${worker.sharedId} · ${worker.label} created.`
      }}>
        <label>Worker name<input name="label" maxLength="120" required /></label>
        <label>Daily capacity <span className="field-hint">(0.01 to 24 hours)</span><input name="capacity" type="number" min="0.01" max="24" step="0.01" defaultValue="8" required /></label>
        <fieldset className="skills-fieldset"><legend>Skills</legend>
          {skills.length ? <div className="checkbox-grid">
            {skills.map(skill => <label key={skill.id} className="checkbox-option"><input type="checkbox" name="skillIds" value={skill.id} /> <span>{skill.name}</span></label>)}
          </div> : <p className="explanation">No skills configured yet.</p>}
        </fieldset>
      </ActionForm>
    </details>

    <details className="action-panel"><summary>Create project account</summary>
      <p className="explanation">Creates an active account and displays its temporary sign-in password once.</p>
      <ActionForm button="Create account" icon="userPlus" resetOnSuccess onSave={async values => {
        const created = await call('/setup/accounts', {
          token, method: 'POST', data: {
            loginLabel: values.get('loginLabel'),
            roleName: values.get('roleName'),
            projectId: values.get('projectId') || undefined
          }
        })
        await refresh()
        setTempCredentialNotice(`Temporary password for ${created.loginLabel}: ${created.temporaryPassword}`)
        return `Created ${created.loginLabel} (${formatRoleLabel(created.roleName).toLowerCase()}). Copy the temporary password shown above.`
      }}>
        <label>Account email <span className="field-hint">(@example.test)</span><input name="loginLabel" type="email" placeholder="officer.two@example.test" required /></label>
        <label>Default role<select name="roleName" required>
          <option value="VIEWER">Viewer</option>
          <option value="SITE_OFFICER">Site officer</option>
          <option value="PROJECT_MANAGER">Project manager</option>
        </select></label>
        <label>Initial project <span className="field-hint">(optional)</span><select name="projectId">
          <option value="">None</option>
          {projects.map(p => <option key={p.sharedId} value={p.sharedId}>{p.name} ({p.sharedId})</option>)}
        </select></label>
      </ActionForm>
    </details>

    <h3>Worker directory ({workers.length})</h3>
    <p className="explanation">Capacity or skill edits flag affected allocations for review.</p>
    {loading && !workers.length ? <TableSkeleton rows={4} cols={5} label="Loading worker directory" />
      : workers.length ? <>
        <div className="report-table-wrap"><table className="stack-mobile">
          <thead><tr><th scope="col">ID</th><th scope="col">Worker</th><th scope="col">Daily capacity</th><th scope="col">Skills</th><th scope="col">Profile change</th></tr></thead>
          <tbody>{workerPager.visible.map(worker => <tr key={worker.sharedId}>
            <th scope="row" className="nowrap">{worker.sharedId}</th>
            <td data-label="Worker">{worker.label}</td>
            <td data-label="Daily capacity" className="nowrap">{worker.dailyCapacityHours} hours</td>
            <td data-label="Skills"><ExpandableText text={worker.skills.join(', ')} fallback="None" /></td>
            <td data-label="Profile change">
              <details><summary>Edit</summary><ActionForm button="Save" icon="check" onSave={async values => {
                const result = await call(`/setup/workers/${worker.sharedId}`, {
                  token, method: 'PATCH', data: {
                    label: values.get('label'),
                    dailyCapacityHours: Number(values.get('capacity')),
                    skillIds: values.getAll('skillIds').map(Number),
                    reason: values.get('reason')
                  }
                })
                await refresh()
                return result.impactedAllocations.length
                  ? `${result.impactedAllocations.length} existing allocation(s) need review: ${result.impactedAllocations.map(row => row.allocationId).join(', ')}.`
                  : 'Worker profile saved. No allocation needs review.'
              }}>
                <label>Name<input name="label" defaultValue={worker.label} required /></label>
                <label>Daily capacity <span className="field-hint">(0.01 to 24 hours)</span><input name="capacity" type="number" min="0.01" max="24" step="0.01" defaultValue={worker.dailyCapacityHours} required /></label>
                <fieldset className="skills-fieldset"><legend>Skills</legend>
                  <div className="checkbox-grid">
                    {skills.map(skill => <label key={skill.id} className="checkbox-option"><input type="checkbox" name="skillIds" value={skill.id} defaultChecked={worker.skillIds.includes(skill.id)} /> <span>{skill.name}</span></label>)}
                  </div>
                </fieldset>
                <label>Reason for change<input name="reason" required /></label>
              </ActionForm></details>
            </td>
          </tr>)}</tbody>
        </table></div>
        <PaginationBar pager={workerPager} label="workers" />
      </> : <p className="empty-state">No workers created yet.</p>}

    <h3>Account directory ({accounts.length})</h3>
    {loading && !accounts.length ? <TableSkeleton rows={3} cols={3} label="Loading accounts" />
      : accounts.length ? <>
        <div className="report-table-wrap"><table className="stack-mobile">
          <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Credentials</th></tr></thead>
          <tbody>{accountPager.visible.map(account => <tr key={account.id}>
            <th scope="row">{account.loginLabel}</th>
            <td data-label="Role"><StatusBadge tone={account.roleName === 'PROJECT_MANAGER' ? 'brand' : 'muted'}>{formatRoleLabel(account.roleName || 'VIEWER')}</StatusBadge></td>
            <td data-label="Credentials">
              <ActionForm button="Reset password" icon="refresh" pendingLabel="Resetting..." onSave={async () => {
                const res = await call(`/setup/accounts/${account.id}/reset-password`, { token, method: 'POST', data: {} })
                setTempCredentialNotice(`New temporary password for ${res.loginLabel}: ${res.temporaryPassword}`)
                return `Temporary password generated for ${res.loginLabel} (shown at top of Setup).`
              }} />
            </td>
          </tr>)}</tbody>
        </table></div>
        <PaginationBar pager={accountPager} label="accounts" />
      </> : <p className="empty-state">No active project accounts found.</p>}
  </section>
}
