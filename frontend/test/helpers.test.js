import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectCsv,
  day,
  formatHashState,
  formatRoleLabel,
  formatStatusLabel,
  parseHashState,
  planChangeSummary,
  safeCsvCell,
  validateNewTask,
  validateWorkingPlan,
  validDay
} from '../src/api.js'

test('day and validDay validate strict YYYY-MM-DD calendar dates', () => {
  assert.equal(day('2026-11-04T00:00:00.000Z'), '2026-11-04')
  assert.equal(day(null), '')
  assert.equal(validDay('2026-11-04'), true)
  assert.equal(validDay('2026-02-30'), false)
  assert.equal(validDay('2026-11-4'), false)
})

test('formatRoleLabel and formatStatusLabel render consistent sentence-case labels', () => {
  assert.equal(formatRoleLabel('PROJECT_MANAGER'), 'Project manager')
  assert.equal(formatRoleLabel('SITE_OFFICER'), 'Site officer')
  assert.equal(formatRoleLabel('ADMIN'), 'Administrator')
  assert.equal(formatStatusLabel('APPROVED'), 'Approved')
  assert.equal(formatStatusLabel('SUBMITTED'), 'Awaiting approval')
  assert.equal(formatStatusLabel('SUPERSEDED'), 'Superseded')
  assert.equal(formatStatusLabel('CANCELLED'), 'Cancelled')
})

test('validateWorkingPlan and validateNewTask reject invalid dates, milestones, and cycles', () => {
  const mk = obj => new Map(Object.entries(obj))
  const wrap = obj => {
    const m = mk(obj)
    return {
      get: k => m.get(k) ?? '',
      has: k => Boolean(m.get(k))
    }
  }

  const badPlan = validateWorkingPlan(wrap({
    title: 'Drainage',
    startDate: '2026-11-06',
    finishDate: '2026-11-04',
    predecessors: 'T102, T101'
  }), 'T102')
  assert.match(badPlan.finishDate, /Finish date/)
  assert.match(badPlan.predecessors, /depend on itself/)

  const badNew = validateNewTask(wrap({
    taskCode: 'BAD',
    newTitle: '',
    newStartDate: '2026-11-04',
    newFinishDate: '2026-11-05',
    newMilestone: true,
    newPredecessors: 'T101, T101'
  }))
  assert.ok(badNew.taskCode)
  assert.ok(badNew.newTitle)
  assert.match(badNew.newFinishDate, /milestone/)
  assert.match(badNew.newPredecessors, /once/)
})

test('planChangeSummary reports required skills and field changes accurately', () => {
  const before = JSON.stringify({ title: 'A', startDate: '2026-11-01', finishDate: '2026-11-02', isMilestone: false, predecessorIds: [1], skillIds: [1] })
  const afterSkills = JSON.stringify({ title: 'A', startDate: '2026-11-01', finishDate: '2026-11-02', isMilestone: false, predecessorIds: [1], skillIds: [1, 2] })
  assert.equal(planChangeSummary(before, afterSkills), 'Changed required skills')
  assert.equal(planChangeSummary(before, before), 'Saved without field changes')
})

test('safeCsvCell protects spreadsheet formulas and buildProjectCsv includes Progress %', () => {
  assert.equal(safeCsvCell('=CMD()'), `"'=CMD()"`)
  assert.equal(safeCsvCell('He said "hi"'), `"He said ""hi"""`)
  const csv = buildProjectCsv({
    project: { sharedId: 'P001' },
    baseline: { versionNo: 2 },
    reportDate: '2026-11-12',
    from: '2026-11-01',
    to: '2026-11-12',
    tasks: [{
      taskId: 'T102',
      title: 'Sub-base compaction',
      status: 'unfinished',
      progressPercent: 65,
      baselineFinish: '2026-11-06T00:00:00Z',
      actualFinish: null,
      finishVarianceDays: null,
      plannedHours: 6,
      recordedHours: 4,
      sources: { baselineId: 1, allocations: [{ id: 10 }], updates: [{ id: 20 }] }
    }]
  })
  assert.match(csv.split('\r\n')[0], /Progress %/)
  assert.match(csv.split('\r\n')[1], /"65"/)
})

test('hash routing round-trips project, section, panel, and taskId cleanly', () => {
  const encoded = formatHashState({ projectId: 'P001', section: 'planning', planningPanel: 'baseline', taskId: 'T102' })
  assert.equal(encoded, '#project=P001&tab=planning&panel=baseline&task=T102')
  assert.deepEqual(parseHashState(encoded), {
    projectId: 'P001',
    section: 'planning',
    planningPanel: 'baseline',
    taskId: 'T102'
  })
  assert.deepEqual(parseHashState('#project=P002&tab=badtab'), {
    projectId: 'P002',
    section: '',
    planningPanel: 'activity',
    taskId: ''
  })
})
