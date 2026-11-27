import React, { useEffect, useState } from 'react'
import { buildProjectCsv, call, day } from '../api.js'
import { ExpandableText, Icon, PaginationBar, ReportSkeleton, SkeletonLines, Spinner, StatusBadge, StatusBanner, TableSkeleton, usePagination } from './UiPrimitives.jsx'

function statusPresentation(row) {
  if (row.overdue) return { tone: 'danger', text: 'Unfinished · Overdue' }
  if (row.status === 'finished') return { tone: 'ok', text: 'Finished' }
  if (row.status === 'unfinished') return { tone: 'warn', text: 'Unfinished' }
  return { tone: 'muted', text: 'Not reported' }
}

export function TaskReport({ workflow, token, baselineId }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const { task, baselines } = workflow

  useEffect(() => {
    if (!baselines.length) return
    const controller = new AbortController()
    const query = baselineId ? `?baselineId=${encodeURIComponent(baselineId)}` : ''
    setReport(null)
    setError('')
    setLoading(true)
    call(`/reports/tasks/${encodeURIComponent(task.sharedId || task.id)}${query}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setReport(result) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [baselineId, workflow, token, retryTick, task.sharedId, task.id, baselines.length])

  return <section>
    <h3>Activity report</h3>
    {!baselines.length && <p>Approve a project baseline to view the activity report.</p>}
    {baselines.length > 0 && <p>Compare against the approved baseline and inspect source records below.</p>}
    {loading && <SkeletonLines count={4} label="Loading activity report" />}
    {error && <StatusBanner kind="error" message={error} actionLabel="Retry" onAction={() => setRetryTick(n => n + 1)} />}
    {baselines.length > 0 && report && <>
      <p>Approved baseline version {report.baselineVersion}.</p>
      <dl>
        <dt>Progress reported</dt><dd>{report.progressPercent == null ? 'Not reported' : `${report.progressPercent}%`}</dd>
        <dt>Baseline finish</dt><dd>{day(report.baselineFinish) || 'Not in baseline'}</dd>
        <dt>Actual finish</dt><dd>{day(report.actualFinish) || 'Not reported'}</dd>
        <dt>Finish variance</dt><dd>{report.finishVarianceDays == null ? 'Not available' : `${report.finishVarianceDays > 0 ? '+' : ''}${report.finishVarianceDays} calendar days`}</dd>
        <dt>Planned allocation hours</dt><dd>{report.plannedHours}</dd>
        <dt>Approved recorded hours</dt><dd>{report.recordedHours ?? 'Not reported'}</dd>
      </dl>
      <details>
        <summary>View source records</summary>
        <h4>Baseline snapshot</h4>
        {report.sources.baselineTask
          ? <p>Baseline version {report.baselineVersion} (source ID {report.baselineId}) · Activity {report.taskId} · Finish {day(report.sources.baselineTask.finishDate)}</p>
          : <p>Activity absent from selected baseline.</p>}
        <h4>Approved allocations</h4>
        {report.sources.allocations.length
          ? <ul>{report.sources.allocations.map(row => <li key={row.id}>Allocation #{row.id} · {day(row.workDate)} · {row.allocatedHours} planned hours</li>)}</ul>
          : <p>No source allocations.</p>}
        <h4>Current approved site updates</h4>
        {report.sources.updates.length ? <ul>{report.sources.updates.map(row =>
          <li key={row.id}>
            Update #{row.id} · Allocation #{row.allocationId} · {day(row.workDate)} · {row.recordedHours ?? 'No'} recorded hours
            {row.progressPercent != null && ` · ${row.progressPercent}%`}
            {row.actualFinishDate && ` · Actual finish ${day(row.actualFinishDate)}`}
          </li>
        )}</ul> : <p>No approved source updates.</p>}
      </details>
    </>}
  </section>
}

export function ProjectReports({ session, projectId, openTask, openPlanning, canManage, mode, baselineId, setBaselineId }) {
  const [baselines, setBaselines] = useState([])
  const [baselinesLoaded, setBaselinesLoaded] = useState(false)
  const [baselineRetry, setBaselineRetry] = useState(0)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingUpdates, setPendingUpdates] = useState([])
  const [pendingError, setPendingError] = useState('')
  const [pendingRetry, setPendingRetry] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [csvNotice, setCsvNotice] = useState('')
  const token = session.token

  useEffect(() => {
    if (!canManage || mode !== 'overview') return
    const controller = new AbortController()
    setPendingError('')
    call(`/projects/${encodeURIComponent(projectId)}/pending-updates`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setPendingUpdates(result.updates); setPendingError('') } })
      .catch(err => { if (!controller.signal.aborted) { setPendingUpdates([]); setPendingError(err.message) } })
    return () => controller.abort()
  }, [projectId, token, canManage, mode, pendingRetry])

  function downloadCsv() {
    if (!report) return
    const csv = buildProjectCsv(report)
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
    setError('')
    if (!projectId) return
    const controller = new AbortController()
    call(`/projects/${encodeURIComponent(projectId)}/baselines`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setBaselines(result.baselines); setBaselinesLoaded(true); setError('') } })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setBaselinesLoaded(true) } })
    return () => controller.abort()
  }, [projectId, token, baselineRetry])

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
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
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

  const q = searchQuery.trim().toLowerCase()
  const filteredTasks = report ? report.tasks.filter(row => {
    const matchStatus = statusFilter === 'all' ? true : statusFilter === 'overdue' ? row.overdue : row.status === statusFilter
    const matchText = !q || row.taskId.toLowerCase().includes(q) || row.title.toLowerCase().includes(q)
    return matchStatus && matchText
  }) : []
  const pager = usePagination(filteredTasks, 25)

  return <section>
    <p className="eyebrow">{mode === 'overview' ? 'Project overview' : 'Reporting'}</p>
    <h2>{mode === 'overview' ? 'Schedule and hours at a glance' : 'Project schedule and hours'}</h2>
    {!baselinesLoaded ? <ReportSkeleton mode={mode} /> : !baselines.length && !error ? <div className="empty-state"><h3>No approved plan yet</h3>
      <p>Approve a project plan to see schedule and hours measures.</p>
      {canManage && <button type="button" onClick={openPlanning}><Icon name="arrowRight" />Open planning</button>}
    </div> : baselines.length > 0 && <form className="report-controls" onSubmit={loadReport}>
      <label>Approved baseline<select value={baselineId} onChange={event => { setBaselineId(event.target.value) }}>
        <option value="">Latest approved baseline</option>
        {baselines.map(row => <option key={row.id} value={row.id}>Version {row.versionNo} · {day(row.approvedAt)}</option>)}
      </select></label>
      <label>Report date<input type="date" value={asOf} onChange={event => { setAsOf(event.target.value) }} required /></label>
      {mode === 'reports' && <>
        <label>Period start <span className="field-hint">(optional)</span><input type="date" value={from} onChange={event => { setFrom(event.target.value) }} /></label>
        <label>Period end <span className="field-hint">(optional)</span><input type="date" value={to} onChange={event => { setTo(event.target.value) }} /></label>
        <div className="report-actions-row">
          <button type="submit" disabled={loading} aria-busy={loading}>{loading ? <Spinner /> : <Icon name="refresh" />}{loading ? 'Refreshing...' : 'Refresh report'}</button>
          {report && <button type="button" onClick={downloadCsv}><Icon name="download" />Export CSV</button>}
        </div>
      </>}
    </form>}
    {error && <StatusBanner kind="error" message={error} actionLabel="Retry" onAction={() => baselines.length ? loadReport() : setBaselineRetry(n => n + 1)} />}
    {baselinesLoaded && loading && !report && <ReportSkeleton mode={mode} />}
    {report && <div className={`report-body${loading ? ' is-refreshing' : ''}`}>
      <h3>{report.project.name} · baseline version {report.baseline.versionNo}</h3>
      <p>Report date {report.reportDate}. Hours period {report.from} to {report.to}.</p>
      {mode === 'reports' && csvNotice && <StatusBanner kind="success" message={csvNotice} onDismiss={() => setCsvNotice('')} />}
      <div className="metric-grid">
        <div className="metric"><span>Activities</span><strong>{report.totals.taskCount}</strong></div>
        <div className="metric"><span>Reported finished</span><strong>{report.totals.finished ?? report.tasks.filter(row => row.status === 'finished').length}</strong></div>
        <div className="metric metric-attention"><span>No progress report</span><strong>{report.tasks.filter(row => row.status === 'not_reported').length}</strong></div>
        <div className="metric"><span>Reported unfinished</span><strong>{report.totals.unfinished}</strong></div>
        <div className="metric"><span>Reported overdue</span><strong>{report.totals.overdue}</strong></div>
        <div className="metric"><span>Planned hours</span><strong>{report.totals.plannedHours}</strong></div>
        <div className="metric"><span>Approved recorded hours</span><strong>{report.totals.recordedHours ?? 'Not reported'}</strong></div>
      </div>
      <p className="explanation">Figures reflect approved records as of the report date; unsubmitted activities appear under &ldquo;No progress report.&rdquo;</p>

      {mode === 'overview' && <div className="overview-list"><h3>Needs attention</h3>
        <ul>{report.tasks.filter(row => row.overdue || row.status === 'not_reported').map(row => <li key={row.taskId}>
          <button type="button" className="text-button" onClick={() => openTask(row.taskId)}>{row.taskId} · {row.title}</button>
          <span><StatusBadge tone={row.overdue ? 'danger' : 'muted'}>{row.overdue ? 'Overdue' : 'Not reported'}</StatusBadge>
            {row.progressPercent != null && ` · ${row.progressPercent}%`}</span>
        </li>)}</ul>
        {!report.tasks.some(row => row.overdue || row.status === 'not_reported') && <p>No activities need attention.</p>}
      </div>}

      {mode === 'overview' && canManage && <div className="overview-list"><h3>Pending approvals</h3>
        {pendingError && <StatusBanner kind="error" message={`Could not load pending approvals: ${pendingError}`} actionLabel="Retry" onAction={() => setPendingRetry(n => n + 1)} />}
        {!pendingError && (pendingUpdates.length ? <ul>{pendingUpdates.map(row => <li key={row.id}>
          <button type="button" className="text-button" onClick={() => openTask(row.taskId, 'site')}>{row.taskId} · {row.title}</button>
          <span>Update #{row.id} · {day(row.workDate)}{row.progressPercent != null ? ` · ${row.progressPercent}%` : ''} · {row.author}</span>
        </li>)}</ul> : <p>No site updates are awaiting a decision.</p>)}
      </div>}

      {mode === 'reports' && <>
        <div className="report-toolbar">
          <div className="report-filters" role="group" aria-label="Filter report activities">
            {[['all', 'All'], ['finished', 'Finished'], ['unfinished', 'Unfinished'], ['overdue', 'Overdue'], ['not_reported', 'Not reported']].map(([key, label]) =>
              <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => { setStatusFilter(key); pager.setPage(1) }}>{label}</button>
            )}
          </div>
          <div className="report-search">
            <label htmlFor="report-activity-search" className="sr-only">Search report activities</label>
            <input id="report-activity-search" type="search" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); pager.setPage(1) }} placeholder="Search activity ID or title" />
          </div>
        </div>
        {!filteredTasks.length ? <p className="empty-state">{q ? `No activities match "${searchQuery.trim()}".` : ({
          finished: 'Nothing has finished yet. Completed updates will appear here.',
          unfinished: 'No unfinished activities reported yet.',
          overdue: 'No overdue activities as of this report date.',
          not_reported: 'All activities have a progress report.',
          all: 'No activities in this project yet.'
        })[statusFilter]}</p> : <>
          <p className="scroll-hint">Swipe across the table to inspect all baseline, hours, and evidence columns.</p>
          <div className="report-table-wrap"><table>
            <thead><tr><th scope="col" className="sticky-col">Activity</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Baseline finish</th><th scope="col">Actual finish</th><th scope="col">Variance</th><th scope="col">Planned</th><th scope="col">Recorded</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{pager.visible.map(row => {
              const badge = statusPresentation(row)
              return <tr key={row.taskId}>
                <th scope="row" className="sticky-col">
                  <button type="button" className="text-button" onClick={() => openTask(row.taskId)}>{row.taskId}</button>
                  {' · '}
                  <ExpandableText text={row.title} limit={40} />
                </th>
                <td className="nowrap"><StatusBadge tone={badge.tone}>{badge.text}</StatusBadge></td>
                <td className="nowrap">
                  {row.progressPercent == null ? <span className="explanation">Not reported</span> : <div className="progress-cell">
                    <span>{row.progressPercent}%</span>
                    <div className="progress-track" aria-hidden="true"><span style={{ width: `${row.progressPercent}%` }} /></div>
                  </div>}
                </td>
                <td className="nowrap">{day(row.baselineFinish) || 'New'}</td>
                <td className="nowrap">{day(row.actualFinish) || 'Not reported'}</td>
                <td className="nowrap">{row.finishVarianceDays == null ? 'Not available' : `${row.finishVarianceDays > 0 ? '+' : ''}${row.finishVarianceDays} d`}</td>
                <td className="nowrap">{row.plannedHours} h</td>
                <td className="nowrap">{row.recordedHours == null ? 'Not reported' : `${row.recordedHours} h`}</td>
                <td><details><summary>Sources</summary>
                  <p>{row.sources.baselineId ? `Baseline v${report.baseline.versionNo} (ID ${row.sources.baselineId})` : 'Not in selected baseline'}; activity {row.taskId}</p>
                  <ul>{row.sources.allocations.map(source => <li key={`a${source.id}`}>Allocation #{source.id} · {day(source.workDate)} · {source.allocatedHours} h</li>)}
                    {row.sources.updates.map(source => <li key={`u${source.id}`}>Update #{source.id} · alloc #{source.allocationId} · {day(source.workDate)} · {source.recordedHours == null ? 'No hours' : `${source.recordedHours} h`}{source.progressPercent != null ? ` · ${source.progressPercent}%` : ''}</li>)}</ul>
                </details></td>
              </tr>
            })}</tbody>
          </table></div>
          <PaginationBar pager={pager} label="activities" />
        </>}
      </>}
    </div>}
  </section>
}

export function PendingUpdatesQueue({ projectId, token, onOpenTask }) {
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    call(`/projects/${encodeURIComponent(projectId)}/pending-updates`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setUpdates(result.updates) })
      .catch(err => { if (!controller.signal.aborted) { setUpdates([]); setError(err.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [projectId, token, retryTick])

  const pager = usePagination(updates, 25)

  return <section>
    <h3>Pending approvals{!loading && !error ? ` (${updates.length})` : ''}</h3>
    {loading ? <TableSkeleton rows={2} cols={6} label="Loading pending approvals" />
      : error ? <StatusBanner kind="error" message={error} actionLabel="Retry" onAction={() => setRetryTick(n => n + 1)} />
      : updates.length ? <>
        <div className="report-table-wrap"><table className="stack-mobile">
          <thead><tr><th scope="col">Update</th><th scope="col">Activity</th><th scope="col">Work date</th><th scope="col">Hours</th><th scope="col">Progress</th><th scope="col">Submitted by</th><th scope="col">Action</th></tr></thead>
          <tbody>{pager.visible.map(row => <tr key={row.id}>
            <th scope="row" className="nowrap">Update #{row.id}</th>
            <td data-label="Activity">{row.taskId} · <ExpandableText text={row.title} limit={56} /></td>
            <td data-label="Work date" className="nowrap">{day(row.workDate)}</td>
            <td data-label="Hours" className="nowrap">{row.recordedHours == null ? 'Not reported' : `${row.recordedHours} h`}</td>
            <td data-label="Progress" className="nowrap">{row.progressPercent == null ? 'Not reported' : `${row.progressPercent}%`}</td>
            <td data-label="Submitted by">{row.author}</td>
            <td data-label="Action"><button type="button" onClick={() => onOpenTask(row.taskId)}><Icon name="arrowRight" />Review</button></td>
          </tr>)}</tbody>
        </table></div>
        <PaginationBar pager={pager} label="pending updates" />
      </> : <p className="empty-state">No site updates are awaiting approval.</p>}
  </section>
}
