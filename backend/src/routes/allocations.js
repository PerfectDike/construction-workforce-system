const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { toDate } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })

router.post('/allocations', async (req, res, next) => {
  try {
    const { workerId, taskId, workDate, hours } = req.body
    if (typeof workerId !== 'string' || typeof taskId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(workDate || '') || typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || !Number.isInteger(hours * 100)) throw fail(422, 'INVALID_ALLOCATION', 'A worker, task, date and positive hours are required')
    const day = toDate(workDate)
    if (day.toISOString().slice(0, 10) !== workDate) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
    const task = await prisma.task.findUnique({ where: { sharedId: taskId }, include: { skills: true } })
    if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found')
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    const worker = await prisma.worker.findUnique({ where: { sharedId: workerId } })
    if (!worker) throw fail(404, 'WORKER_NOT_FOUND', 'Worker not found')
    const allocation = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${worker.id} FOR UPDATE`
      const current = await tx.baseline.findFirst({ where: { projectId: task.projectId }, orderBy: { versionNo: 'desc' }, include: { tasks: true } })
      const planned = current?.tasks.find(row => row.taskId === task.id)
      if (!planned || day < planned.startDate || day > planned.finishDate || planned.isMilestone) throw fail(422, 'OUTSIDE_APPROVED_DATES', 'Work date must be within the approved non-milestone task')
      const skills = await tx.workerSkill.findMany({ where: { workerId: worker.id } })
      if (task.skills.some(skill => !skills.some(w => w.skillId === skill.skillId))) throw fail(422, 'SKILL_MISMATCH', 'Worker lacks a required skill')
      const available = await tx.workerAvailability.findUnique({ where: { workerId_workDate: { workerId: worker.id, workDate: day } } })
      if (!available) throw fail(422, 'AVAILABILITY_UNKNOWN', 'No availability was declared for this date')
      const sum = await tx.allocation.aggregate({ where: { workerId: worker.id, workDate: day, status: 'APPROVED' }, _sum: { allocatedHours: true } })
      const capacity = Math.min(Number(available.availableHours), Number(worker.dailyCapacityHours))
      if (Math.round((Number(sum._sum.allocatedHours || 0) + hours) * 100) > Math.round(capacity * 100)) throw fail(422, 'OVER_CAPACITY', 'The worker does not have enough available hours')
      return tx.allocation.create({ data: { workerId: worker.id, taskId: task.id, workDate: day, allocatedHours: hours } })
    })
    res.status(201).json(allocation)
  } catch (e) { next(e) }
})
module.exports = router
