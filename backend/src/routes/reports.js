const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { toDate, varianceInDays } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
  let date
  try { date = toDate(value) } catch (_) { throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date') }
  if (date.toISOString().slice(0, 10) !== value) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
  return date
}
router.get('/reports/tasks/:taskId', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { sharedId: req.params.taskId } })
    if (!task) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } })
    await requireProject(req.actor, task.projectId)
    let baseline
    if (req.query.baselineId) {
      const id = Number(req.query.baselineId)
      if (!Number.isInteger(id)) return res.status(422).json({ error: { code: 'INVALID_BASELINE', message: 'Invalid baseline' } })
      baseline = await prisma.baseline.findFirst({ where: { id, projectId: task.projectId }, include: { tasks: true } })
    } else baseline = await prisma.baseline.findFirst({ where: { projectId: task.projectId }, orderBy: { versionNo: 'desc' }, include: { tasks: true } })
    if (!baseline) return res.status(404).json({ error: { code: 'BASELINE_NOT_FOUND', message: 'Approved baseline not found' } })
    const planned = baseline.tasks.find(row => row.taskId === task.id)
    const allocations = await prisma.allocation.findMany({ where: { taskId: task.id, status: 'APPROVED' }, orderBy: { id: 'asc' } })
    const updates = await prisma.siteUpdate.findMany({ where: { taskId: task.id, status: 'APPROVED', isCurrent: true }, orderBy: [{ workDate: 'asc' }, { id: 'asc' }] })
    const finished = updates.filter(row => row.actualFinishDate).at(-1)
    const recorded = updates.filter(row => row.recordedHours !== null)
    res.json({ taskId: task.sharedId, baselineId: baseline.id, baselineVersion: baseline.versionNo,
      baselineFinish: planned?.finishDate ?? null, actualFinish: finished?.actualFinishDate ?? null,
      finishVarianceDays: planned && finished ? varianceInDays(finished.actualFinishDate, planned.finishDate) : null,
      plannedHours: allocations.reduce((n, a) => n + Number(a.allocatedHours), 0),
      recordedHours: recorded.length ? recorded.reduce((n, u) => n + Number(u.recordedHours), 0) : null,
      hoursStatus: recorded.length ? 'reported' : 'not_reported',
      sources: { baselineId: baseline.id, taskId: task.id, allocationIds: allocations.map(a => a.id), updateIds: updates.map(u => u.id), baselineTask: planned || null, allocations, updates: updates.map(({ id, workDate, recordedHours, actualFinishDate, allocationId }) => ({ id, workDate, recordedHours, actualFinishDate, allocationId })) } })
  } catch (e) { next(e) }
})
router.get('/reports/projects/:projectId', async (req, res, next) => {
  try {
    const reference = req.params.projectId
    const project = await prisma.project.findUnique({
      where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference }
    })
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', 'Project not found')
    await requireProject(req.actor, project.id)
    const reportDateText = req.query.asOf || new Date().toISOString().slice(0, 10)
    const reportDate = calendarDate(reportDateText)
    const fromText = req.query.from || reportDateText.slice(0, 7) + '-01'
    const toText = req.query.to || reportDateText
    const from = calendarDate(fromText)
    const to = calendarDate(toText)
    if (from > to) throw fail(422, 'INVALID_PERIOD', 'Period start must not follow period end')
    if (to > reportDate) throw fail(422, 'INVALID_PERIOD', 'Period end must not follow the report date')
    let baseline
    if (req.query.baselineId) {
      const id = Number(req.query.baselineId)
      if (!Number.isInteger(id) || id < 1) throw fail(422, 'INVALID_BASELINE', 'Invalid baseline')
      baseline = await prisma.baseline.findFirst({ where: { id, projectId: project.id }, include: { tasks: true } })
    } else {
      baseline = await prisma.baseline.findFirst({
        where: { projectId: project.id }, orderBy: { versionNo: 'desc' }, include: { tasks: true }
      })
    }
    if (!baseline) throw fail(404, 'BASELINE_NOT_FOUND', 'Approved baseline not found')
    const [tasks, allocations, updates] = await Promise.all([
      prisma.task.findMany({ where: { projectId: project.id }, orderBy: { taskCode: 'asc' } }),
      prisma.allocation.findMany({
        where: { task: { projectId: project.id }, status: 'APPROVED', workDate: { gte: from, lte: to } },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }]
      }),
      prisma.siteUpdate.findMany({
        where: { task: { projectId: project.id }, status: 'APPROVED', isCurrent: true, workDate: { lte: reportDate } },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }]
      })
    ])
    const plannedById = new Map(baseline.tasks.map(row => [row.taskId, row]))
    const rows = tasks.map(task => {
      const planned = plannedById.get(task.id) || null
      const taskUpdates = updates.filter(row => row.taskId === task.id)
      const periodUpdates = taskUpdates.filter(row => row.workDate >= from && row.workDate <= to && row.recordedHours !== null)
      const taskAllocations = allocations.filter(row => row.taskId === task.id)
      const finished = taskUpdates.filter(row => row.actualFinishDate).at(-1)
      const hasStatus = taskUpdates.some(row => row.progressPercent !== null)
      const status = finished ? 'finished' : hasStatus ? 'unfinished' : 'not_reported'
      return {
        taskId: task.sharedId || String(task.id), taskCode: task.taskCode,
        title: planned?.title || task.title, baselineStatus: planned ? 'included' : 'new',
        taskStatus: task.status, status,
        overdue: status === 'unfinished' && !!planned && planned.finishDate < reportDate,
        baselineFinish: planned?.finishDate || null,
        actualFinish: finished?.actualFinishDate || null,
        finishVarianceDays: planned && finished ? varianceInDays(finished.actualFinishDate, planned.finishDate) : null,
        plannedHours: taskAllocations.reduce((sum, row) => sum + Number(row.allocatedHours), 0),
        recordedHours: periodUpdates.length ? periodUpdates.reduce((sum, row) => sum + Number(row.recordedHours), 0) : null,
        hoursStatus: periodUpdates.length ? 'reported' : 'not_reported',
        sources: {
          baselineId: planned ? baseline.id : null,
          baselineTask: planned,
          allocations: taskAllocations.map(row => ({ id: row.id, workerId: row.workerId, workDate: row.workDate, allocatedHours: row.allocatedHours })),
          updates: taskUpdates.map(row => ({
            id: row.id, allocationId: row.allocationId, workDate: row.workDate,
            recordedHours: row.recordedHours, actualFinishDate: row.actualFinishDate, progressPercent: row.progressPercent
          }))
        }
      }
    })
    const reported = rows.filter(row => row.recordedHours !== null)
    res.json({
      project: { id: project.id, sharedId: project.sharedId, name: project.name },
      reportDate: reportDateText, from: fromText, to: toText,
      baseline: { id: baseline.id, versionNo: baseline.versionNo, approvedAt: baseline.approvedAt },
      tasks: rows,
      totals: {
        taskCount: rows.length, unfinished: rows.filter(row => row.status === 'unfinished').length,
        overdue: rows.filter(row => row.overdue).length,
        plannedHours: rows.reduce((sum, row) => sum + row.plannedHours, 0),
        recordedHours: reported.length ? reported.reduce((sum, row) => sum + row.recordedHours, 0) : null,
        reportedTaskCount: reported.length
      }
    })
  } catch (error) { next(error) }
})
module.exports = router

