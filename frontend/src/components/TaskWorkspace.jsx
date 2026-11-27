import React, { useEffect, useState } from 'react'
import { call, day } from '../api.js'
import { Icon, StatusBadge, StatusBanner, TaskSkeleton } from './UiPrimitives.jsx'
import { Planning } from './Planning.jsx'
import { Workforce } from './Workforce.jsx'
import { SiteUpdates } from './SiteUpdates.jsx'
import { TaskReport } from './Reports.jsx'

export function TaskWorkspace({ taskId, tasks = [], onSelectTask, session, section, reportBaselineId, onTasksChange, openWorkforce, openBaseline }) {
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
      if (/^\/(?:projects\/[^/]+\/tasks|tasks\/[^/]+(?:\/inactivate|\/reactivate)?|allocations|site-updates)/.test(url)) {
        onTasksChange?.()
      }
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
    {error && <StatusBanner kind="error" message={error} actionLabel="Refresh task" onAction={() => refresh().catch(err => setError(err.message))} />}
    {!workflow && !error && <TaskSkeleton />}
    {workflow && <>
      <div className="task-header">
        <div>
          <h2>{workflow.task.sharedId ?? workflow.task.taskCode} · {workflow.task.title}</h2>
          <p>
            {workflow.task.project.name} · Working dates {day(workflow.task.startDate)} to {day(workflow.task.finishDate)} ·{' '}
            <StatusBadge tone={workflow.task.status === 'WORKING' ? 'ok' : 'muted'}>
              {workflow.task.status === 'WORKING' ? 'Working' : 'Inactive'}
            </StatusBadge>
            {workflow.task.isMilestone && <> <StatusBadge tone="brand">Milestone</StatusBadge></>}
          </p>
        </div>
        {tasks.length > 0 && (() => {
          const idx = tasks.findIndex(row => (row.sharedId || String(row.id)) === String(taskId))
          const prev = idx > 0 ? tasks[idx - 1] : null
          const next = idx >= 0 && idx < tasks.length - 1 ? tasks[idx + 1] : null
          return <div className="task-stepper">
            <button type="button" onClick={() => onSelectTask?.('')}><Icon name="list" />All activities</button>
            <button type="button" disabled={!prev} onClick={() => prev && onSelectTask?.(prev.sharedId || String(prev.id))}><Icon name="prev" />Previous</button>
            <button type="button" disabled={!next} onClick={() => next && onSelectTask?.(next.sharedId || String(next.id))}>Next<Icon name="next" /></button>
          </div>
        })()}
      </div>
      {section === 'planning' && workflow.permissions.plan && <Planning workflow={workflow} busy={busy} mutate={mutate} openWorkforce={openWorkforce} token={session.token} />}
      {section === 'workforce' && <Workforce workflow={workflow} busy={busy} mutate={mutate} token={token} openBaseline={openBaseline} />}
      {section === 'site' && <SiteUpdates workflow={workflow} busy={busy} mutate={mutate} />}
      {section === 'reports' && workflow.task.sharedId && <TaskReport workflow={workflow} token={token} baselineId={reportBaselineId} />}
      {section === 'planning' && !workflow.permissions.plan && <p>Your project role cannot change the working plan.</p>}
    </>}
  </>
}
