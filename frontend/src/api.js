const api = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ?? '/api'

export const day = value => value?.slice(0, 10) ?? ''

const ROLE_LABELS = {
  ADMIN: 'Administrator',
  PROJECT_MANAGER: 'Project manager',
  SITE_OFFICER: 'Site officer',
  VIEWER: 'Viewer'
}

const STATUS_LABELS = {
  APPROVED: 'Approved',
  SUBMITTED: 'Awaiting approval',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  SUPERSEDED: 'Superseded',
  CANCELLED: 'Cancelled',
  WORKING: 'Working',
  INACTIVE: 'Inactive'
}

export function formatRoleLabel(role) {
  if (!role) return ''
  if (ROLE_LABELS[role]) return ROLE_LABELS[role]
  const plain = String(role).replaceAll('_', ' ').toLowerCase()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

export function formatStatusLabel(status) {
  if (!status) return ''
  if (STATUS_LABELS[status]) return STATUS_LABELS[status]
  const plain = String(status).replaceAll('_', ' ').toLowerCase()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

export const validDay = value =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

export async function call(path, { token, method = 'GET', data, signal } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (data !== undefined) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch(`${api}${path}`, {
      method,
      headers,
      signal,
      body: data === undefined ? undefined : JSON.stringify(data)
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error('Unable to reach the server. Check your connection and try again.')
  }
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = null
  }
  if (!response.ok) {
    if (response.status === 401 && token && !path.startsWith('/auth/login')) {
      throw new Error('Your session has expired. Sign in again.')
    }
    throw new Error(
      body?.error?.message ||
      (text && text.length < 180 ? text.trim() : `Server error (${response.status}). Check backend configuration.`)
    )
  }
  if (body === null) throw new Error('Unexpected non-JSON response from the server.')
  return body
}

export function validateWorkingPlan(values, taskId) {
  const errors = {}
  const start = values.get('startDate')
  const finish = values.get('finishDate')
  if (!values.get('title')?.trim()) errors.title = 'Enter an activity title.'
  if (!validDay(start)) errors.startDate = 'Enter a valid start date.'
  if (!validDay(finish)) errors.finishDate = 'Enter a valid finish date.'
  else if (validDay(start) && finish < start) errors.finishDate = 'Finish date must not precede start date.'
  else if (values.has('isMilestone') && validDay(start) && finish !== start) errors.finishDate = 'A milestone uses one date.'
  const ids = (values.get('predecessors') || '').split(',').map(id => id.trim().toUpperCase()).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.predecessors = 'List each predecessor once.'
  else if (ids.includes(String(taskId).toUpperCase())) errors.predecessors = 'An activity cannot depend on itself.'
  return errors
}

export function validateNewTask(values) {
  const errors = {}
  const code = values.get('taskCode')?.trim().toUpperCase() || ''
  if (!/^T\d{3,}$/.test(code)) errors.taskCode = 'Use T followed by 3 or more digits (for example T107).'
  const start = values.get('newStartDate')
  const finish = values.get('newFinishDate')
  if (!values.get('newTitle')?.trim()) errors.newTitle = 'Enter an activity title.'
  if (!validDay(start)) errors.newStartDate = 'Enter a valid start date.'
  if (!validDay(finish)) errors.newFinishDate = 'Enter a valid finish date.'
  else if (validDay(start) && finish < start) errors.newFinishDate = 'Finish date must not precede start date.'
  else if (values.has('newMilestone') && validDay(start) && finish !== start) errors.newFinishDate = 'A milestone uses one date.'
  const ids = (values.get('newPredecessors') || '').split(',').map(id => id.trim().toUpperCase()).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.newPredecessors = 'List each predecessor once.'
  else if (code && ids.includes(code)) errors.newPredecessors = 'An activity cannot depend on itself.'
  return errors
}

export function planChangeSummary(beforeText, afterText) {
  try {
    const before = JSON.parse(beforeText)
    const after = JSON.parse(afterText)
    const labels = {
      title: 'title',
      startDate: 'start date',
      finishDate: 'finish date',
      isMilestone: 'milestone status'
    }
    const changed = Object.entries(labels)
      .filter(([key]) => before[key] !== after[key])
      .map(([, label]) => label)
    if (JSON.stringify(before.predecessorIds || []) !== JSON.stringify(after.predecessorIds || [])) {
      changed.push('predecessor links')
    }
    const prevSkills = [...(before.skillIds || [])].sort((a, b) => a - b)
    const nextSkills = [...(after.skillIds || [])].sort((a, b) => a - b)
    if (JSON.stringify(prevSkills) !== JSON.stringify(nextSkills)) {
      changed.push('required skills')
    }
    return changed.length ? `Changed ${changed.join(', ')}` : 'Saved without field changes'
  } catch {
    return 'Plan changed'
  }
}

export function safeCsvCell(value) {
  const raw = value == null ? '' : String(value)
  const protectedText = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${protectedText.replaceAll('"', '""')}"`
}

export function buildProjectCsv(report) {
  const columns = [
    'Project ID', 'Baseline version', 'Report date', 'Period start', 'Period end',
    'Activity ID', 'Activity', 'Status', 'Progress %', 'Baseline finish', 'Actual finish',
    'Finish variance days', 'Planned hours', 'Recorded hours', 'Baseline source ID',
    'Allocation source IDs', 'Update source IDs'
  ]
  const rows = report.tasks.map(row => [
    report.project.sharedId,
    report.baseline.versionNo,
    report.reportDate,
    report.from,
    report.to,
    row.taskId,
    row.title,
    row.status,
    row.progressPercent == null ? '' : row.progressPercent,
    day(row.baselineFinish),
    day(row.actualFinish),
    row.finishVarianceDays,
    row.plannedHours,
    row.recordedHours,
    row.sources.baselineId,
    row.sources.allocations.map(source => source.id).join('; '),
    row.sources.updates.map(source => source.id).join('; ')
  ])
  return [columns, ...rows].map(row => row.map(safeCsvCell).join(',')).join('\r\n')
}

export function parseHashState(hashText) {
  const clean = (hashText || '').replace(/^#/, '')
  const params = new URLSearchParams(clean)
  const validSections = new Set(['setup', 'overview', 'planning', 'workforce', 'site', 'reports'])
  const validPanels = new Set(['activity', 'baseline', 'accounts'])
  const tab = params.get('tab')
  const panel = params.get('panel')
  return {
    projectId: params.get('project') || '',
    section: validSections.has(tab) ? tab : '',
    planningPanel: validPanels.has(panel) ? panel : 'activity',
    taskId: params.get('task') || ''
  }
}

export function formatHashState({ projectId, section, planningPanel, taskId }) {
  const params = new URLSearchParams()
  if (projectId) params.set('project', projectId)
  if (section) params.set('tab', section)
  if (section === 'planning' && planningPanel && planningPanel !== 'activity') params.set('panel', planningPanel)
  if (taskId && ['planning', 'workforce', 'site', 'reports'].includes(section)) params.set('task', taskId)
  const encoded = params.toString()
  return encoded ? `#${encoded}` : ''
}
