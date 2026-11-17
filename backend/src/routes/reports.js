const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { varianceInDays } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
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
module.exports = router

