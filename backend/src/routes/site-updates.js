const express = require('express')
const { randomUUID } = require('crypto')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { toDate } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })

router.post('/site-updates', async (req, res, next) => {
  try {
    const { allocationId, recordedHours, workDate, actualFinishDate, note, supersedesId } = req.body
    if (!Number.isInteger(allocationId) || typeof recordedHours !== 'number' || !Number.isFinite(recordedHours) || recordedHours < 0 || !Number.isInteger(recordedHours * 100) || !/^\d{4}-\d{2}-\d{2}$/.test(workDate || '')) throw fail(422, 'INVALID_UPDATE', 'A valid allocation, work date and non-negative hours are required')
    const day = toDate(workDate)
    if (day.toISOString().slice(0, 10) !== workDate) throw fail(422, 'INVALID_DATE', 'Enter a valid work date')
    const allocation = await prisma.allocation.findUnique({ where: { id: allocationId }, include: { task: true } })
    if (!allocation || allocation.status !== 'APPROVED' || allocation.workDate.valueOf() !== day.valueOf()) throw fail(422, 'INVALID_ALLOCATION', 'An approved allocation for this work date is required')
    await requireProject(req.actor, allocation.task.projectId, ['SITE_OFFICER'])
    let previous = null
    if (supersedesId != null) {
      previous = await prisma.siteUpdate.findUnique({ where: { id: Number(supersedesId) } })
      if (!previous || !previous.isCurrent || previous.status !== 'APPROVED' || previous.allocationId !== allocationId) throw fail(422, 'INVALID_CORRECTION', 'Correction must reference the current approved entry for this allocation')
    }
    let finish = null
    if (actualFinishDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFinishDate)) throw fail(422, 'INVALID_DATE', 'Enter a valid finish date')
      finish = toDate(actualFinishDate)
      if (finish.toISOString().slice(0, 10) !== actualFinishDate) throw fail(422, 'INVALID_DATE', 'Enter a valid finish date')
    }
    const row = await prisma.siteUpdate.create({ data: { entryKey: previous?.entryKey || randomUUID(), taskId: allocation.taskId, allocationId, authorId: Number(req.actor.sub), workDate: day, recordedHours, actualFinishDate: finish, note, supersedesId: previous?.id, status: 'SUBMITTED' } })
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.post('/site-updates/:id/approve', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const update = await prisma.siteUpdate.findUnique({ where: { id }, include: { task: true } })
    if (!update) throw fail(404, 'NOT_FOUND', 'Update not found')
    await requireProject(req.actor, update.task.projectId, ['PROJECT_MANAGER'])
    if (update.authorId === Number(req.actor.sub)) throw fail(403, 'SELF_APPROVAL', 'You cannot approve your own update')
    const approved = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "SiteUpdate" WHERE id = ${id} FOR UPDATE`
      const current = await tx.siteUpdate.findUnique({ where: { id } })
      if (current.status !== 'SUBMITTED') throw fail(409, 'INVALID_STATE', 'Update is not awaiting approval')
      if (current.supersedesId) {
        const changed = await tx.siteUpdate.updateMany({ where: { id: current.supersedesId, status: 'APPROVED', isCurrent: true }, data: { status: 'SUPERSEDED', isCurrent: false } })
        if (changed.count !== 1) throw fail(409, 'STALE_CORRECTION', 'The original entry is no longer current')
      }
      const row = await tx.siteUpdate.update({ where: { id }, data: { status: 'APPROVED', isCurrent: true, approvedById: Number(req.actor.sub) } })
      await tx.provenanceEvent.create({ data: { entityType: 'SiteUpdate', entityId: id, action: 'APPROVED', fromState: 'SUBMITTED', toState: 'APPROVED', actorId: Number(req.actor.sub) } })
      return row
    })
    res.json(approved)
  } catch (e) { next(e) }
})
router.get('/tasks/:taskId/site-updates', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { sharedId: req.params.taskId } })
    if (!task) throw fail(404, 'NOT_FOUND', 'Task not found')
    await requireProject(req.actor, task.projectId)
    res.json(await prisma.siteUpdate.findMany({ where: { taskId: task.id, status: 'APPROVED', isCurrent: true }, orderBy: { id: 'asc' } }))
  } catch (e) { next(e) }
})
module.exports = router

