const express = require('express')
const { prisma } = require('../db')
const { allowRoles, requireAuth } = require('../middleware/auth')
const { assertAcyclic, validateTaskDates } = require('../services/planning')

const router = express.Router()
router.use(requireAuth)

async function assertProjectAccess(actor, projectId) {
  if (actor.role === 'ADMIN') return

  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId: actor.sub, projectId } },
  })
  if (!membership) {
    const error = new Error('You do not have access to this project')
    error.status = 403
    throw error
  }
}

router.post('/projects/:projectId/tasks', allowRoles('ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId)
    await assertProjectAccess(req.actor, projectId)
    const { taskCode, title, description, startDate, finishDate, isMilestone, predecessorIds = [] } = req.body
    const { start, finish } = validateTaskDates({ startDate, finishDate, isMilestone })
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    const predecessors = await prisma.task.findMany({ where: { id: { in: predecessorIds } }, select: { id: true, projectId: true } })
    if (predecessors.length !== predecessorIds.length || predecessors.some((task) => task.projectId !== projectId)) {
      return res.status(422).json({ error: { code: 'INVALID_DEPENDENCY', message: 'Each predecessor must exist in the same project' } })
    }
    const task = await prisma.task.create({ data: { projectId, taskCode, title, description, startDate: start, finishDate: finish, isMilestone: Boolean(isMilestone) } })
    if (predecessorIds.length) await prisma.taskDependency.createMany({ data: predecessorIds.map((predecessorId) => ({ predecessorId, successorId: task.id })) })
    return res.status(201).json(task)
  } catch (error) { next(error) }
})

router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.taskId) }, include: { predecessors: true, skills: true } })
    return task ? res.json(task) : res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
  } catch (error) { next(error) }
})

router.post('/projects/:projectId/baselines', allowRoles('ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId)
    await assertProjectAccess(req.actor, projectId)
    const tasks = await prisma.task.findMany({ where: { projectId, status: 'WORKING' }, orderBy: { id: 'asc' } })
    if (!tasks.length) return res.status(422).json({ error: { code: 'NO_TASKS', message: 'A baseline requires working tasks' } })
    tasks.forEach(validateTaskDates)
    const dependencies = await prisma.taskDependency.findMany({ where: { successor: { projectId } } })
    assertAcyclic(dependencies)
    const latest = await prisma.baseline.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' } })
    const baseline = await prisma.$transaction(async (tx) => {
      const created = await tx.baseline.create({ data: { projectId, versionNo: (latest?.versionNo ?? 0) + 1, previousBaselineId: latest?.id, approvedById: req.actor.sub, reason: req.body.reason } })
      await tx.baselineTask.createMany({ data: tasks.map((task) => ({ baselineId: created.id, taskId: task.id, taskCode: task.taskCode, title: task.title, startDate: task.startDate, finishDate: task.finishDate, isMilestone: task.isMilestone })) })
      if (dependencies.length) await tx.baselineDependency.createMany({ data: dependencies.map((edge) => ({ baselineId: created.id, predecessorId: edge.predecessorId, successorId: edge.successorId })) })
      return tx.baseline.findUnique({ where: { id: created.id }, include: { tasks: true, dependencies: true } })
    })
    return res.status(201).json(baseline)
  } catch (error) { next(error) }
})

module.exports = router
