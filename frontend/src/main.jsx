import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { call, day, formatHashState, formatRoleLabel, formatStatusLabel, parseHashState } from './api.js'
import {
  ActionForm,
  AppErrorBoundary,
  BrandMark,
  ExpandableText,
  Icon,
  PaginationBar,
  PasswordInput,
  SkeletonLines,
  StatusBadge,
  StatusBanner,
  TableSkeleton,
  usePagination
} from './components/UiPrimitives.jsx'
import { ProjectAccounts, ProjectBaselineApproval, ProjectTaskCreation } from './components/Planning.jsx'
import { PendingUpdatesQueue, ProjectReports } from './components/Reports.jsx'
import { AdminSetup } from './components/AdminSetup.jsx'
import { TaskWorkspace } from './components/TaskWorkspace.jsx'

function readTokenExpMs(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000
  } catch {
    return 0
  }
}

function ActivityListSection({ section, canManage, projectTasks, tasksLoading, onSelectTask }) {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const q = search.trim().toLowerCase()
  const filtered = projectTasks.filter(task => {
    if (!showInactive && task.status !== 'WORKING') return false
    if (!q) return true
    return (task.sharedId || task.taskCode || '').toLowerCase().includes(q) || (task.title || '').toLowerCase().includes(q)
  })
  const pager = usePagination(filtered, 25)
  const inactiveCount = projectTasks.filter(task => task.status !== 'WORKING').length

  if (tasksLoading) {
    return <section><h3>Project activities</h3><TableSkeleton rows={5} cols={5} label="Loading project activities" /></section>
  }
  if (!projectTasks.length) return <p className="empty-state">No activities in this project yet.</p>

  return <section>
    <div className="section-head-row">
      <div>
        <h3>Project activities ({filtered.length}{showInactive || !inactiveCount ? '' : ` active of ${projectTasks.length}`})</h3>
        <p className="explanation">{section === 'workforce'
          ? 'Select an activity to view worker eligibility and manage allocations.'
          : section === 'site'
            ? (canManage ? 'Select an activity to review or withdraw site updates.' : 'Select an activity with an approved allocation to submit site hours.')
            : 'Select an activity below to edit its working plan.'}</p>
      </div>
      <div className="activity-list-controls">
        {inactiveCount > 0 && <label className="checkbox-inline">
          <input type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); pager.setPage(1) }} />
          <span>Show inactive ({inactiveCount})</span>
        </label>}
        <div className="report-search">
          <label htmlFor="activity-list-search" className="sr-only">Filter activities</label>
          <input id="activity-list-search" type="search" value={search} onChange={e => { setSearch(e.target.value); pager.setPage(1) }} placeholder="Filter by ID or title" />
        </div>
      </div>
    </div>

    {!filtered.length ? <p className="empty-state">No activities match the current filter.</p> : <>
      <div className="report-table-wrap"><table className="stack-mobile">
        <thead><tr>
          <th scope="col" className="sticky-col">ID</th>
          <th scope="col">Activity</th>
          <th scope="col">Working dates</th>
          {section === 'planning' && <th scope="col">Predecessors</th>}
          {(section === 'planning' || section === 'workforce') && <th scope="col">Skills</th>}
          {(section === 'workforce' || section === 'site') && <th scope="col">Allocations</th>}
          {section === 'site' && canManage && <th scope="col">Pending</th>}
          <th scope="col">Status</th>
          <th scope="col">Action</th>
        </tr></thead>
        <tbody>{pager.visible.map(task => <tr key={task.id}>
          <th scope="row" className="sticky-col nowrap">{task.sharedId || task.taskCode}</th>
          <td data-label="Activity">
            <ExpandableText text={task.title} limit={64} />
            {task.isMilestone && <> <StatusBadge tone="brand">Milestone</StatusBadge></>}
          </td>
          <td data-label="Working dates" className="nowrap">{day(task.startDate)} to {day(task.finishDate)}</td>
          {section === 'planning' && <td data-label="Predecessors"><ExpandableText text={task.predecessorIds?.join(', ')} fallback="None" /></td>}
          {(section === 'planning' || section === 'workforce') && <td data-label="Skills"><ExpandableText text={task.skillNames?.join(', ')} fallback="None" /></td>}
          {(section === 'workforce' || section === 'site') && <td data-label="Allocations" className="nowrap">
            {task.approvedAllocationCount
              ? <StatusBadge tone="ok">{task.approvedAllocationCount} approved</StatusBadge>
              : <StatusBadge tone="muted">{section === 'site' && !canManage ? 'No allocation' : '0'}</StatusBadge>}
          </td>}
          {section === 'site' && canManage && <td data-label="Pending" className="nowrap">
            {task.pendingUpdateCount ? <StatusBadge tone="warn">{task.pendingUpdateCount} pending</StatusBadge> : '0'}
          </td>}
          <td data-label="Status" className="nowrap">
            <StatusBadge tone={task.status === 'WORKING' ? 'ok' : 'muted'}>{formatStatusLabel(task.status)}</StatusBadge>
          </td>
          <td data-label="Action">
            <button type="button" onClick={() => onSelectTask(task.sharedId || String(task.id))}>
              <Icon name="arrowRight" />{section === 'site' && !canManage && task.approvedAllocationCount > 0 ? 'Submit' : 'Open'}
            </button>
          </td>
        </tr>)}</tbody>
      </table></div>
      <PaginationBar pager={pager} label="activities" />
    </>}
  </section>
}

export function App() {
  const initialHash = parseHashState(window.location.hash)
  const [session, setSession] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('cws-session') || 'null')
      return saved?.token && readTokenExpMs(saved.token) > Date.now() ? saved : null
    } catch { return null }
  })
  const [capabilities, setCapabilities] = useState({ mailConfigured: true })
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsRetry, setProjectsRetry] = useState(0)
  const [projectTasks, setProjectTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [projectId, setProjectId] = useState(initialHash.projectId)
  const [section, setSection] = useState(initialHash.section || 'overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [planningPanel, setPlanningPanel] = useState(initialHash.planningPanel || 'activity')
  const [reportBaselineId, setReportBaselineId] = useState('')
  const [projectsError, setProjectsError] = useState('')
  const [taskId, setTaskId] = useState(initialHash.taskId)
  const [visit, setVisit] = useState(0)
  const [taskListVersion, setTaskListVersion] = useState(0)
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    call('/capabilities', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCapabilities(result) })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (session) sessionStorage.setItem('cws-session', JSON.stringify(session))
    else sessionStorage.removeItem('cws-session')
  }, [session])

  useEffect(() => {
    setSessionExpiringSoon(false)
    if (!session) return
    const expiry = readTokenExpMs(session.token)
    if (!expiry) { setSession(null); return }
    const remaining = expiry - Date.now()
    const warnMs = Math.max(0, remaining - 5 * 60 * 1000)
    const warnTimer = setTimeout(() => setSessionExpiringSoon(true), warnMs)
    const expireTimer = setTimeout(() => setSession(null), Math.max(0, remaining))
    return () => { clearTimeout(warnTimer); clearTimeout(expireTimer) }
  }, [session])

  useEffect(() => {
    if (!session) { setProjects([]); setProjectId(''); setProjectsLoading(false); return }
    const controller = new AbortController()
    setProjectsLoading(true)
    setProjectsError('')
    call('/projects', { token: session.token, signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setProjects(result.projects)
        setProjectId(current => result.projects.some(p => p.sharedId === current) ? current : (result.projects[0]?.sharedId || ''))
        setProjectsError('')
      })
      .catch(error => { if (!controller.signal.aborted) setProjectsError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setProjectsLoading(false) })
    return () => controller.abort()
  }, [session, projectsRetry])

  useEffect(() => {
    setProjectTasks([])
    if (!session || !projectId) { setTasksLoading(false); return }
    const controller = new AbortController()
    setTasksLoading(true)
    call(`/projects/${encodeURIComponent(projectId)}/tasks`, { token: session.token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setProjectTasks(result.tasks) })
      .catch(error => { if (!controller.signal.aborted) setProjectsError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setTasksLoading(false) })
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

  useEffect(() => {
    if (session && projects.length && !sections.some(([key]) => key === section)) {
      setSection(isAdmin ? 'setup' : 'overview')
    }
  }, [session, projects.length, projectId, section, canManage, canSite, isAdmin])

  useEffect(() => {
    if (!session) return
    const nextHash = formatHashState({ projectId, section, planningPanel, taskId })
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash || window.location.pathname + window.location.search)
    }
  }, [session, projectId, section, planningPanel, taskId])

  useEffect(() => {
    const onHashChange = () => {
      if (!session) return
      const parsed = parseHashState(window.location.hash)
      if (parsed.projectId && parsed.projectId !== projectId) setProjectId(parsed.projectId)
      if (parsed.section) setSection(parsed.section)
      if (parsed.planningPanel) setPlanningPanel(parsed.planningPanel)
      setTaskId(parsed.taskId)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [session, projectId])

  const signOut = () => {
    setSession(null)
    setReportBaselineId('')
    setTaskId('')
    setSection('overview')
    setMenuOpen(false)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }

  const openTaskById = id => {
    setTaskId(id)
    setVisit(current => current + 1)
  }

  const showQuickTaskJump = Boolean(taskId && ((section === 'planning' && planningPanel === 'activity') || section === 'workforce' || section === 'site'))

  const shell = <main className={session ? 'app-shell' : 'auth-shell'}>
    <header className="app-header"><div className="brand"><BrandMark /><h1>CWS</h1></div>
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
          <button type="button" className="nav-signout" onClick={signOut}><Icon name="logout" />Sign out</button>
        </nav>
        <div className="account"><span>{session.user.loginLabel}</span><button type="button" onClick={signOut}><Icon name="logout" />Sign out</button></div>
      </>}
    </header>

    {!session && resetToken ? <>
      <h2>Reset password</h2>
      <ActionForm button="Save password" pendingLabel="Saving password..." onSave={async values => {
        const result = await call('/auth/recovery/reset', {
          method: 'POST', data: { token: resetToken, newPassword: values.get('newPassword') }
        })
        window.history.replaceState({}, '', window.location.pathname)
        setResetToken('')
        setRecoveryMessage(result.message)
        return result.message
      }}>
        <PasswordInput label="New password" hint="at least 12 characters" name="newPassword" autoComplete="new-password" minLength="12" required />
      </ActionForm>
      <button type="button" onClick={() => { window.history.replaceState({}, '', window.location.pathname); setResetToken('') }}>Back to sign in</button>
    </> : !session && recoveryMode && capabilities.mailConfigured ? <>
      <h2>Recover account</h2>
      <p>Enter your account email to request a password reset link.</p>
      <ActionForm button="Request reset link" pendingLabel="Sending link..." onSave={async values => {
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
      {recoveryMessage && <StatusBanner kind="success" message={recoveryMessage} onDismiss={() => setRecoveryMessage('')} />}
      <ActionForm button="Sign in" pendingLabel="Signing in..." onSave={async values => {
        const signedIn = await call('/auth/login', {
          method: 'POST', data: { loginLabel: values.get('email'), password: values.get('password') }
        })
        setSession(signedIn)
        const parsed = parseHashState(window.location.hash)
        setSection(parsed.section || (signedIn.user.role === 'ADMIN' ? 'setup' : 'overview'))
      }}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <PasswordInput label="Password" name="password" autoComplete="current-password" required />
      </ActionForm>
      {capabilities.mailConfigured
        ? <button type="button" onClick={() => setRecoveryMode(true)}>Forgot password?</button>
        : <p className="explanation">Password reset via email is disabled in this environment. Ask an administrator to issue a temporary password in Setup.</p>}
    </> : <>
      {sessionExpiringSoon && <StatusBanner kind="info"
        message="Your sign-in session expires in under 5 minutes. Save any edits or sign out and back in."
        actionLabel="Sign out now" onAction={signOut} onDismiss={() => setSessionExpiringSoon(false)} />}
      {projectsError && <StatusBanner kind="error" message={projectsError} actionLabel="Retry" onAction={() => { setProjectsRetry(n => n + 1); setTaskListVersion(n => n + 1) }} onDismiss={() => setProjectsError('')} />}
      {projectsLoading && !projects.length && <section><SkeletonLines count={2} label="Loading projects" /></section>}
      {projects.length > 0 && <div className="project-bar"><label className="project-switcher">Project<select value={projectId} onChange={event => { setProjectId(event.target.value); setReportBaselineId(''); setTaskId(''); setPlanningPanel('activity'); setSection('overview'); setMenuOpen(false) }}>
        {projects.map(project => <option key={project.sharedId} value={project.sharedId}>{project.name} ({project.sharedId})</option>)}
      </select></label>{selectedProject && <p className="project-context">Your role: {formatRoleLabel(selectedProject.role)}</p>}</div>}

      <div className="view-stage">
        {selectedProject && <>
          {section === 'planning' && canManage && <nav className="planning-nav" aria-label="Planning areas">
            {[['activity', 'Activities'], ['baseline', 'Approve schedule'], ['accounts', 'Project access']].map(([key, label]) =>
              <button key={key} type="button" aria-current={planningPanel === key ? 'page' : undefined}
                onClick={() => setPlanningPanel(key)}>{label}</button>)}
          </nav>}

          {showQuickTaskJump && <label className="task-switcher">Switch activity
            <select value={taskId} disabled={tasksLoading} onChange={event => openTaskById(event.target.value)}>
              <option value="">All activities</option>
              {projectTasks.map(task => <option key={task.id} value={task.sharedId || task.id}>{task.sharedId || task.taskCode} · {task.title}{task.status !== 'WORKING' ? ' (inactive)' : ''}</option>)}
            </select>
          </label>}

          {section === 'reports' && taskId && <div className="task-detail-panel">
            <div className="task-header">
              <p className="eyebrow">Selected activity breakdown</p>
              <button type="button" onClick={() => setTaskId('')}><Icon name="x" />Close activity detail</button>
            </div>
            <TaskWorkspace key={`${projectId}-${taskId}-${visit}`} taskId={taskId} tasks={projectTasks}
              onSelectTask={openTaskById} session={session} section="reports" reportBaselineId={reportBaselineId}
              onTasksChange={() => setTaskListVersion(current => current + 1)}
              openWorkforce={() => setSection('workforce')} openBaseline={() => { setPlanningPanel('baseline'); setSection('planning') }} />
          </div>}

          {(section === 'overview' || section === 'reports') && <ProjectReports key={projectId} session={session} projectId={projectId} mode={section}
            baselineId={reportBaselineId} setBaselineId={setReportBaselineId}
            canManage={canManage} openPlanning={() => { setPlanningPanel('baseline'); setSection('planning') }}
            openTask={(id, targetSection) => {
              const task = projectTasks.find(row => row.id === Number(id) || row.sharedId === String(id))
              openTaskById(String(task?.sharedId || id))
              setSection(targetSection || (canSite && !canManage ? 'site' : 'reports'))
            }} />}

          {section === 'planning' && planningPanel === 'baseline' && <ProjectBaselineApproval key={projectId} projectId={projectId}
            projectName={selectedProject.name} token={session.token} openOverview={() => setSection('overview')}
            onApproved={() => setTaskListVersion(current => current + 1)} />}

          {section === 'planning' && planningPanel === 'accounts' && <ProjectAccounts projectId={projectId}
            token={session.token} isAdmin={isAdmin} mailConfigured={capabilities.mailConfigured}
            openSetup={() => setSection('setup')} />}

          {section === 'site' && canManage && !taskId && <PendingUpdatesQueue projectId={projectId} token={session.token} onOpenTask={openTaskById} />}

          {section !== 'overview' && section !== 'reports' && (section !== 'planning' || planningPanel === 'activity') && taskId &&
            <TaskWorkspace key={`${projectId}-${taskId}-${visit}`} taskId={taskId} tasks={projectTasks}
              onSelectTask={openTaskById} session={session} section={section} reportBaselineId={reportBaselineId}
              onTasksChange={() => setTaskListVersion(current => current + 1)}
              openWorkforce={() => setSection('workforce')} openBaseline={() => { setPlanningPanel('baseline'); setSection('planning') }} />}

          {section !== 'overview' && section !== 'reports' && (section !== 'planning' || planningPanel === 'activity') && !taskId &&
            <ActivityListSection section={section} canManage={canManage} projectTasks={projectTasks}
              tasksLoading={tasksLoading} onSelectTask={openTaskById} />}

          {section === 'planning' && planningPanel === 'activity' && !taskId && <ProjectTaskCreation projectId={projectId}
            token={session.token} onCreated={() => setTaskListVersion(current => current + 1)} />}
        </>}

        {isAdmin && section === 'setup' && <AdminSetup token={session.token} projects={projects} onProjectCreated={project => {
          setProjects(current => [...current, { ...project, role: 'ADMIN' }])
          setProjectId(project.sharedId)
        }} />}
      </div>
    </>}
  </main>

  return session ? shell : <div className="auth-page">{shell}</div>
}

if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>)
}
