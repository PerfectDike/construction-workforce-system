const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { toDate } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })

function input(body) {
  const { workerId, workDate, hours } = body
  if (typeof workerId !== 'string' || !workerId.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(workDate || '') || typeof hours !== 'number' ||
      !Number.isFinite(hours) || hours <= 0 || Math.abs(hours * 100 - Math.round(hours * 100)) > 0.000001) {
    throw fail(422, 'INVALID_ALLOCATION', 'A worker, task, date and positive hours with at most two decimal places are required')
  }
  let day
  try { day = toDate(workDate) } catch (_) { throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date') }
  if (day.toISOString().slice(0, 10) !== workDate) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
  return { workerId, day, hours }
}

router.get('/tasks/:taskId/workforce-options', async (req, res, next) => {
  try {
    const reference = req.params.taskId
    const task = await prisma.task.findUnique({
      where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference },
      include: { skills: true }
    })
    if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found')
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    if (typeof req.query.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
    }
    let day
    try { day = toDate(req.query.date) } catch (_) { throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date') }
    if (day.toISOString().slice(0, 10) !== req.query.date) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
    const [baseline, workers] = await Promise.all([
      prisma.baseline.findFirst({ where: { projectId: task.projectId }, orderBy: { versionNo: 'desc' }, include: { tasks: true } }),
      prisma.worker.findMany({
        where: { sharedId: { not: null } }, include: {
          skills: true, availability: { where: { workDate: day } },
          allocations: { where: { workDate: day, status: 'APPROVED' } }
        }, orderBy: { sharedId: 'asc' }
      })
    ])
    const planned = baseline?.tasks.find(row => row.taskId === task.id)
    const dateAllowed = !!planned && !planned.isMilestone && day >= planned.startDate && day <= planned.finishDate
    res.json({ taskId: task.sharedId || String(task.id), date: req.query.date,
      baselineId: baseline?.id || null,
      workers: workers.map(worker => {
        const missingSkills = task.skills.filter(required => !worker.skills.some(skill => skill.skillId === required.skillId)).length
        const available = worker.availability[0]
        const committedHours = worker.allocations.reduce((sum, row) => sum + Number(row.allocatedHours), 0)
        const capacity = available ? Math.min(Number(available.availableHours), Number(worker.dailyCapacityHours)) : null
        const remainingHours = capacity === null ? null : Math.max(0, capacity - committedHours)
        const flags = [
          ...(!dateAllowed ? ['OUTSIDE_APPROVED_DATES'] : []),
          ...(missingSkills ? ['SKILL_MISMATCH'] : []),
          ...(!available ? ['AVAILABILITY_UNKNOWN'] : []),
          ...(capacity !== null && committedHours > capacity ? ['OVER_CAPACITY'] : []),
          ...(remainingHours === 0 ? ['FULLY_ALLOCATED'] : [])
        ]
        return { workerId: worker.sharedId, label: worker.label, availableHours: available ? Number(available.availableHours) : null,
          committedHours, remainingHours, flags, eligible: flags.length === 0 }
      })
    })
  } catch (error) { next(error) }
})

router.patch('/projects/:projectId/workers/:workerId/availability/:workDate', async (req, res, next) => {
  try {
    const reference = req.params.projectId
    const project = await prisma.project.findUnique({
      where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference }
    })
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', 'Project not found')
    await requireProject(req.actor, project.id, ['PROJECT_MANAGER'])
    const { workDate } = req.params
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
    let day
    try { day = toDate(workDate) } catch (_) { throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date') }
    if (day.toISOString().slice(0, 10) !== workDate) throw fail(422, 'INVALID_DATE', 'Enter a valid calendar date')
    const availableHours = req.body.availableHours
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
    if (typeof availableHours !== 'number' || !Number.isFinite(availableHours) || availableHours < 0 || availableHours > 24 ||
        Math.abs(availableHours * 100 - Math.round(availableHours * 100)) > 0.000001) {
      throw fail(422, 'INVALID_AVAILABILITY', 'Availability must be between 0 and 24 hours with at most two decimal places')
    }
    if (!reason) throw fail(422, 'REASON_REQUIRED', 'Give a reason for the availability change')
    const worker = await prisma.worker.findUnique({ where: { sharedId: req.params.workerId } })
    if (!worker) throw fail(404, 'WORKER_NOT_FOUND', 'Worker not found')
    const result = await prisma.$transaction(async tx => {
      await lockWorkers(tx, [worker.id])
      const availability = await tx.workerAvailability.upsert({
        where: { workerId_workDate: { workerId: worker.id, workDate: day } },
        update: { availableHours }, create: { workerId: worker.id, workDate: day, availableHours }
      })
      const allocations = await tx.allocation.findMany({
        where: { workerId: worker.id, workDate: day, status: 'APPROVED' },
        include: { task: { include: { project: true } } }, orderBy: { id: 'asc' }
      })
      const allocatedHours = allocations.reduce((total, allocation) => total + Number(allocation.allocatedHours), 0)
      const capacityHours = Math.min(availableHours, Number(worker.dailyCapacityHours))
      const affected = allocatedHours > capacityHours
      await tx.provenanceEvent.create({ data: {
        entityType: 'WorkerAvailability', entityId: availability.id, action: 'AVAILABILITY_CHANGED',
        actorId: Number(req.actor.sub), reason
      } })
      return {
        workerId: worker.sharedId, workDate, availableHours: Number(availability.availableHours), capacityHours, allocatedHours, affected,
        impactedAllocations: affected ? allocations.map(allocation => ({
          allocationId: allocation.id, taskId: allocation.task.sharedId, projectId: allocation.task.project.sharedId,
          allocatedHours: Number(allocation.allocatedHours)
        })) : []
      }
    })
    res.json(result)
  } catch (error) { next(error) }
})

async function lockWorkers(tx, ids) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${id} FOR NO KEY UPDATE`
  }
}

async function check(tx, { worker, task, day, hours, excludeId }) {
  if (task.status !== 'WORKING') throw fail(422, 'TASK_INACTIVE', 'Cannot allocate work to an inactive task')
  const baseline = await tx.baseline.findFirst({
    where: { projectId: task.projectId }, orderBy: { versionNo: 'desc' }, include: { tasks: true }
  })
  const planned = baseline?.tasks.find(row => row.taskId === task.id)
  if (!planned || day < planned.startDate || day > planned.finishDate || planned.isMilestone) {
    throw fail(422, 'OUTSIDE_APPROVED_DATES', 'Work date must be within the approved non-milestone task')
  }
  const skills = await tx.workerSkill.findMany({ where: { workerId: worker.id } })
  if (task.skills.some(skill => !skills.some(row => row.skillId === skill.skillId))) {
    throw fail(422, 'SKILL_MISMATCH', 'Worker lacks a required skill')
  }
  const availability = await tx.workerAvailability.findUnique({
    where: { workerId_workDate: { workerId: worker.id, workDate: day } }
  })
  if (!availability) throw fail(422, 'AVAILABILITY_UNKNOWN', 'No availability was declared for this date')
  const sum = await tx.allocation.aggregate({
    where: { workerId: worker.id, workDate: day, status: 'APPROVED', ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { allocatedHours: true }
  })
  const capacity = Math.min(Number(availability.availableHours), Number(worker.dailyCapacityHours))
  if (Math.round((Number(sum._sum.allocatedHours || 0) + hours) * 100) > Math.round(capacity * 100)) {
    throw fail(422, 'OVER_CAPACITY', 'The worker does not have enough available hours')
  }
}

router.post('/allocations', async (req, res, next) => {
  try {
    const values = input(req.body)
    const taskRef = String(req.body.taskId ?? '')
    if (!taskRef) throw fail(422, 'INVALID_ALLOCATION', 'A task is required')
    const task = await prisma.task.findUnique({
      where: /^\d+$/.test(taskRef) ? { id: Number(taskRef) } : { sharedId: taskRef },
      include: { skills: true }
    })
    if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found')
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    const worker = await prisma.worker.findUnique({ where: { sharedId: values.workerId } })
    if (!worker) throw fail(404, 'WORKER_NOT_FOUND', 'Worker not found')
    const saved = await prisma.$transaction(async tx => {
      await lockWorkers(tx, [worker.id])
      await check(tx, { worker, task, ...values })
      return tx.allocation.create({ data: { workerId: worker.id, taskId: task.id, workDate: values.day, allocatedHours: values.hours } })
    })
    res.status(201).json(saved)
  } catch (error) { next(error) }
})

router.patch('/allocations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) throw fail(422, 'INVALID_ALLOCATION', 'Invalid allocation ID')
    const original = await prisma.allocation.findUnique({ where: { id }, include: { task: { include: { skills: true } } } })
    if (!original) throw fail(404, 'ALLOCATION_NOT_FOUND', 'Allocation not found')
    await requireProject(req.actor, original.task.projectId, ['PROJECT_MANAGER'])
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason) throw fail(422, 'REASON_REQUIRED', 'Give a reason for the allocation change')
    const values = input(req.body)
    const worker = await prisma.worker.findUnique({ where: { sharedId: values.workerId } })
    if (!worker) throw fail(404, 'WORKER_NOT_FOUND', 'Worker not found')
    const replacement = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${id} FOR UPDATE`
      const current = await tx.allocation.findUniqueOrThrow({ where: { id } })
      if (current.status !== 'APPROVED') throw fail(409, 'ALLOCATION_CHANGED', 'This allocation was already changed')
      await lockWorkers(tx, [current.workerId, worker.id])
      await check(tx, { worker, task: original.task, ...values, excludeId: id })
      await tx.allocation.update({ where: { id }, data: { status: 'SUPERSEDED' } })
      const saved = await tx.allocation.create({ data: {
        workerId: worker.id, taskId: current.taskId, workDate: values.day,
        allocatedHours: values.hours, replacesId: id, reason
      } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'Allocation', entityId: id, action: 'REVISED',
        fromState: 'APPROVED', toState: 'SUPERSEDED', actorId: Number(req.actor.sub), reason
      } })
      return saved
    })
    res.status(201).json(replacement)
  } catch (error) { next(error) }
})

router.post('/allocations/:id/cancel', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) throw fail(422, 'INVALID_ALLOCATION', 'Invalid allocation ID')
    const allocation = await prisma.allocation.findUnique({ where: { id }, include: { task: true } })
    if (!allocation) throw fail(404, 'ALLOCATION_NOT_FOUND', 'Allocation not found')
    await requireProject(req.actor, allocation.task.projectId, ['PROJECT_MANAGER'])
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason) throw fail(422, 'REASON_REQUIRED', 'Give a reason for the cancellation')
    const cancelled = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${id} FOR UPDATE`
      const current = await tx.allocation.findUniqueOrThrow({ where: { id } })
      if (current.status !== 'APPROVED') throw fail(409, 'ALLOCATION_CHANGED', 'This allocation was already changed')
      await lockWorkers(tx, [current.workerId])
      const saved = await tx.allocation.update({ where: { id }, data: { status: 'CANCELLED', reason } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'Allocation', entityId: id, action: 'CANCELLED',
        fromState: 'APPROVED', toState: 'CANCELLED', actorId: Number(req.actor.sub), reason
      } })
      return saved
    })
    res.json(cancelled)
  } catch (error) { next(error) }
})
module.exports = router
