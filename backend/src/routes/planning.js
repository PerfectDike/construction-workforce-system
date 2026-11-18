const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { assertAcyclic, validateTaskDates } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
const bad = (message) => Object.assign(new Error(message), { status: 422 })
const lookup = value => /^\d+$/.test(value) ? { id: Number(value) } : { sharedId: value }

async function validateDependencies(tx, projectId, taskId, predecessorIds, proposed) {
  if (!Array.isArray(predecessorIds) || new Set(predecessorIds.map(String)).size !== predecessorIds.length) throw bad('Predecessors must be a list of distinct task IDs')
  const predecessors = []
  for (const id of predecessorIds) {
    const pred = await tx.task.findUnique({ where: lookup(String(id)) })
    if (!pred || pred.projectId !== projectId || pred.status !== 'WORKING') throw bad('Each predecessor must exist in the same project')
    predecessors.push(pred)
  }
  const all = await tx.taskDependency.findMany({ where: { successor: { projectId } } })
  const edges = all.filter(edge => edge.successorId !== taskId).concat(predecessors.map(pred => ({ predecessorId: pred.id, successorId: taskId })))
  try { assertAcyclic(edges) } catch (e) { throw bad(e.message) }
  const tasks = await tx.task.findMany({ where: { projectId, status: 'WORKING' } })
  const byId = new Map(tasks.map(task => [task.id, task]))
  byId.set(taskId, { ...byId.get(taskId), ...proposed })
  for (const edge of edges) {
    const pred = byId.get(edge.predecessorId), succ = byId.get(edge.successorId)
    if (!pred || !succ) throw bad('Dependencies must reference active tasks in the same project')
    const earliest = pred.finishDate.valueOf() + (pred.isMilestone ? 0 : 86400000)
    if (succ.startDate.valueOf() < earliest) throw bad('A successor starts before its predecessor permits')
  }
  return predecessors
}

router.get('/tasks/:taskId/workflow', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: lookup(req.params.taskId),
      select: {
        id: true, sharedId: true, taskCode: true, title: true, startDate: true, finishDate: true,
        isMilestone: true, projectId: true,
        project: { select: { id: true, name: true, sharedId: true } },
        predecessors: { select: { predecessor: { select: { id: true, sharedId: true } } } }
      }
    })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    const role = await requireProject(req.actor, task.projectId)
    const manage = ['ADMIN', 'PROJECT_MANAGER'].includes(role)
    const baselines = await prisma.baseline.findMany({
      where: { projectId: task.projectId },
      select: { id: true, versionNo: true },
      orderBy: { versionNo: 'desc' }
    })
    res.json({ task, permissions: { plan: manage }, baselines })
  } catch (e) { next(e) }
})

router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: lookup(req.params.taskId), include: { predecessors: { include: { predecessor: true } }, skills: true } })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    await requireProject(req.actor, task.projectId)
    res.json(task)
  } catch (e) { next(e) }
})

router.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: lookup(req.params.taskId), include: { predecessors: true } })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    const { start, finish } = validateTaskDates({ startDate: req.body.startDate ?? task.startDate, finishDate: req.body.finishDate ?? task.finishDate, isMilestone: req.body.isMilestone ?? task.isMilestone })
    const proposed = { title: req.body.title ?? task.title, startDate: start, finishDate: finish, isMilestone: req.body.isMilestone ?? task.isMilestone }
    const predecessorIds = req.body.predecessorIds ?? task.predecessors.map(edge => edge.predecessorId)
    const saved = await prisma.$transaction(async tx => {
      const predecessors = await validateDependencies(tx, task.projectId, task.id, predecessorIds, proposed)
      const allocations = await tx.allocation.count({ where: { taskId: task.id, status: 'APPROVED', OR: [{ workDate: { lt: start } }, { workDate: { gt: finish } }] } })
      if (allocations) throw bad('The proposed dates conflict with existing allocations')
      await tx.taskDependency.deleteMany({ where: { successorId: task.id } })
      if (predecessors.length) await tx.taskDependency.createMany({ data: predecessors.map(pred => ({ predecessorId: pred.id, successorId: task.id })) })
      return tx.task.update({ where: { id: task.id }, data: proposed, include: { predecessors: { include: { predecessor: true } } } })
    })
    res.json(saved)
  } catch (e) { next(e) }
})

router.post('/projects/:projectId/tasks', async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId)
    await requireProject(req.actor, projectId, ['PROJECT_MANAGER'])
    const { taskCode, title, description, startDate, finishDate, isMilestone = false, predecessorIds = [] } = req.body
    if (!taskCode || !title) throw bad('Task code and title are required')
    const { start, finish } = validateTaskDates({ startDate, finishDate, isMilestone })
    const task = await prisma.$transaction(async tx => {
      const created = await tx.task.create({ data: { projectId, taskCode, title, description, startDate: start, finishDate: finish, isMilestone } })
      const predecessors = await validateDependencies(tx, projectId, created.id, predecessorIds, created)
      if (predecessors.length) await tx.taskDependency.createMany({ data: predecessors.map(pred => ({ predecessorId: pred.id, successorId: created.id })) })
      return created
    })
    res.status(201).json(task)
  } catch (e) { next(e) }
})

router.post('/projects/:projectId/baselines', async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId)
    await requireProject(req.actor, projectId, ['PROJECT_MANAGER'])
    const baseline = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`
      const tasks = await tx.task.findMany({ where: { projectId, status: 'WORKING' }, orderBy: { id: 'asc' } })
      if (!tasks.length) throw bad('A baseline requires working tasks')
      tasks.forEach(validateTaskDates)
      const dependencies = await tx.taskDependency.findMany({ where: { successor: { projectId } } })
      try { assertAcyclic(dependencies) } catch (e) { throw bad(e.message) }
      const map = new Map(tasks.map(t => [t.id, t]))
      for (const edge of dependencies) {
        const a = map.get(edge.predecessorId), b = map.get(edge.successorId)
        if (!a || !b || b.startDate.valueOf() < a.finishDate.valueOf() + (a.isMilestone ? 0 : 86400000)) throw bad('Invalid task dependency or date conflict')
      }
      const latest = await tx.baseline.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' } })
      const created = await tx.baseline.create({ data: { projectId, versionNo: (latest?.versionNo ?? 0) + 1, previousBaselineId: latest?.id, approvedById: Number(req.actor.sub), reason: req.body.reason } })
      await tx.baselineTask.createMany({ data: tasks.map(task => ({ baselineId: created.id, taskId: task.id, taskCode: task.taskCode, title: task.title, startDate: task.startDate, finishDate: task.finishDate, isMilestone: task.isMilestone })) })
      if (dependencies.length) await tx.baselineDependency.createMany({ data: dependencies.map(edge => ({ baselineId: created.id, predecessorId: edge.predecessorId, successorId: edge.successorId })) })
      return tx.baseline.findUnique({ where: { id: created.id }, include: { tasks: true, dependencies: true } })
    })
    res.status(201).json(baseline)
  } catch (e) { next(e) }
})
module.exports = router
