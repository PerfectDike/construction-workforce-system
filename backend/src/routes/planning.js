const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { assertAcyclic, validateTaskDates } = require('../services/planning')
const router = express.Router()
router.use(requireAuth)
router.get('/projects', async (req, res, next) => {
  try {
    const userId = Number(req.actor.sub)
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } })
    if (!user || user.accountStatus !== 'ACTIVE') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Account is unavailable' } })
    if (user.role.name === 'ADMIN') {
      const projects = await prisma.project.findMany({ orderBy: { id: 'asc' } })
      return res.json({ projects: projects.map(row => ({ id: row.id, sharedId: row.sharedId, name: row.name, status: row.status, role: 'ADMIN' })) })
    }
    const memberships = await prisma.projectMembership.findMany({ where: { userId }, include: { project: true }, orderBy: { projectId: 'asc' } })
    res.json({ projects: memberships.map(row => ({ id: row.project.id, sharedId: row.project.sharedId, name: row.project.name,
      status: row.project.status, role: row.roleName || user.role.name })) })
  } catch (error) { next(error) }
})
router.get('/projects/:projectId/baselines', async (req, res, next) => {
  try {
    const reference = req.params.projectId
    const project = await prisma.project.findUnique({ where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference } })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    await requireProject(req.actor, project.id)
    const baselines = await prisma.baseline.findMany({
      where: { projectId: project.id },
      select: { id: true, versionNo: true, approvedAt: true, reason: true },
      orderBy: { versionNo: 'desc' }
    })
    res.json({ baselines })
  } catch (error) { next(error) }
})
router.get('/projects/:projectId/tasks', async (req, res, next) => {
  try {
    const reference = req.params.projectId
    const project = await prisma.project.findUnique({ where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference } })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    await requireProject(req.actor, project.id)
    const tasks = await prisma.task.findMany({
      where: { projectId: project.id },
      select: { id: true, sharedId: true, taskCode: true, title: true, status: true,
        startDate: true, finishDate: true, isMilestone: true, skills: { select: { skillId: true } },
        predecessors: { select: { predecessor: { select: { id: true, sharedId: true, taskCode: true } } } }
      },
      orderBy: { taskCode: 'asc' }
    })
    res.json({ tasks: tasks.map(({ predecessors, skills, ...task }) => ({ ...task,
      skillIds: skills.map(row => row.skillId),
      predecessorIds: predecessors.map(({ predecessor }) => predecessor.sharedId || predecessor.taskCode || String(predecessor.id))
    })) })
  } catch (error) { next(error) }
})
const bad = (message) => Object.assign(new Error(message), { status: 422 })
const lookup = value => /^\d+$/.test(value) ? { id: Number(value) } : { sharedId: value }
async function validateSkills(tx, ids) {
  if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw bad('Choose valid required skills')
  if (await tx.skill.count({ where: { id: { in: ids } } }) !== ids.length) throw bad('A required skill does not exist')
  return ids
}

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
        id: true, sharedId: true, taskCode: true, title: true, startDate: true, finishDate: true, status: true,
        isMilestone: true, projectId: true, skills: { select: { skillId: true } },
        project: { select: { id: true, name: true, sharedId: true } },
        predecessors: { select: { predecessor: { select: { id: true, sharedId: true } } } }
      }
    })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    const role = await requireProject(req.actor, task.projectId)
    const manage = ['ADMIN', 'PROJECT_MANAGER'].includes(role)
    const baselines = await prisma.baseline.findMany({
      where: { projectId: task.projectId },
      select: { id: true, versionNo: true, approvedAt: true, reason: true,
        tasks: { where: { taskId: task.id }, select: { title: true, startDate: true, finishDate: true, isMilestone: true } },
        dependencies: { where: { successorId: task.id }, select: { predecessorId: true } }
      },
      orderBy: { versionNo: 'desc' }
    })
    const projectTaskRefs = await prisma.task.findMany({ where: { projectId: task.projectId }, select: { id: true, sharedId: true, taskCode: true } })
    const taskRefById = new Map(projectTaskRefs.map(row => [row.id, row.sharedId || row.taskCode || String(row.id)]))
    const submitHours = ['ADMIN', 'SITE_OFFICER'].includes(role)
    const [allocations, workers, updates, allocationHistory] = await Promise.all([
      prisma.allocation.findMany({
        where: { taskId: task.id, status: 'APPROVED' },
        select: { id: true, workDate: true, allocatedHours: true, worker: { select: { label: true, sharedId: true } } },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }]
      }),
      manage ? prisma.worker.findMany({
        where: { sharedId: { not: null } },
        select: { sharedId: true, label: true },
        orderBy: { sharedId: 'asc' }
      }) : [],
      manage || submitHours ? prisma.siteUpdate.findMany({
        where: manage ? { taskId: task.id } : {
          taskId: task.id,
          OR: [
            { status: 'APPROVED', isCurrent: true },
            { status: 'SUBMITTED', authorId: Number(req.actor.sub) }
          ]
        },
        select: {
          id: true, allocationId: true, status: true, workDate: true, recordedHours: true,
          actualFinishDate: true, note: true, supersedesId: true, authorId: true,
          decisionReason: true, isCurrent: true
        },
        orderBy: { id: 'asc' }
      }) : [],
      manage ? prisma.allocation.findMany({
        where: { taskId: task.id },
        select: {
          id: true, workDate: true, allocatedHours: true, status: true,
          replacesId: true, reason: true, createdAt: true,
          worker: { select: { label: true, sharedId: true } }
        },
        orderBy: { id: 'asc' }
      }) : []
    ])
    const allocationEvents = manage && allocationHistory.length
      ? await prisma.provenanceEvent.findMany({
        where: { entityType: 'Allocation', entityId: { in: allocationHistory.map(row => row.id) } },
        select: {
          entityId: true, action: true, reason: true, occurredAt: true,
          actor: { select: { loginLabel: true } }
        },
        orderBy: { id: 'asc' }
      }) : []
    const planHistory = manage ? await prisma.provenanceEvent.findMany({
      where: { entityType: 'Task', entityId: task.id, action: 'WORKING_PLAN_REVISED' },
      select: { action: true, fromState: true, toState: true, reason: true, occurredAt: true,
        actor: { select: { loginLabel: true } } }, orderBy: { id: 'desc' }
    }) : []
    res.json({
      task, baselines: baselines.map(({ tasks, dependencies, ...baseline }) => ({ ...baseline,
        taskSnapshot: tasks[0] || null,
        predecessorIds: dependencies.map(edge => taskRefById.get(edge.predecessorId) || String(edge.predecessorId))
      })), allocations, workers, planHistory,
      allocationHistory: allocationHistory.map(row => ({
        ...row, events: allocationEvents.filter(event => event.entityId === row.id)
      })),
      permissions: { plan: manage, allocate: manage, submitHours, approveHours: manage },
      updates: updates.map(({ authorId, ...update }) => ({
        ...update, canApprove: manage && update.status === 'SUBMITTED' && authorId !== Number(req.actor.sub)
      }))
    })
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
    const task = await prisma.task.findUnique({ where: lookup(req.params.taskId), include: { predecessors: true, skills: true } })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    if (task.status !== 'WORKING') throw Object.assign(new Error('Inactive task cannot be changed'), { status: 409, code: 'TASK_INACTIVE' })
    const { start, finish } = validateTaskDates({ startDate: req.body.startDate ?? task.startDate, finishDate: req.body.finishDate ?? task.finishDate, isMilestone: req.body.isMilestone ?? task.isMilestone })
    const title = req.body.title === undefined ? task.title : String(req.body.title).trim()
    if (!title) throw bad('Task title is required')
    const proposed = { title, startDate: start, finishDate: finish, isMilestone: req.body.isMilestone ?? task.isMilestone }
    const predecessorIds = req.body.predecessorIds ?? task.predecessors.map(edge => edge.predecessorId)
    const saved = await prisma.$transaction(async tx => {
      const ids = await validateSkills(tx, req.body.skillIds ?? task.skills.map(row => row.skillId))
      const allocations = await tx.allocation.findMany({ where: { taskId: task.id, status: 'APPROVED' }, include: { worker: { include: { skills: true } } } })
      const mismatch = allocations.find(row => ids.some(id => !row.worker.skills.some(skill => skill.skillId === id)))
      if (mismatch) throw bad(`Required skills would exclude approved allocation ${mismatch.id}. Revise that allocation first.`)
      const predecessors = await validateDependencies(tx, task.projectId, task.id, predecessorIds, proposed)
      const conflict = await tx.allocation.findFirst({
        where: { taskId: task.id, status: 'APPROVED', OR: [{ workDate: { lt: start } }, { workDate: { gt: finish } }] },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
        select: { id: true, workDate: true, worker: { select: { label: true } } }
      })
      if (conflict) {
        const workDate = conflict.workDate.toISOString().slice(0, 10)
        throw bad(`The proposed dates exclude allocation ${conflict.id} for ${conflict.worker.label} on ${workDate}.`)
      }
      await tx.taskDependency.deleteMany({ where: { successorId: task.id } })
      if (predecessors.length) await tx.taskDependency.createMany({ data: predecessors.map(pred => ({ predecessorId: pred.id, successorId: task.id })) })
      await tx.taskSkill.deleteMany({ where: { taskId: task.id } })
      if (ids.length) await tx.taskSkill.createMany({ data: ids.map(skillId => ({ taskId: task.id, skillId })) })
      const updated = await tx.task.update({ where: { id: task.id }, data: proposed, include: { predecessors: { include: { predecessor: true } }, skills: true } })
      const snapshot = (row, ids) => JSON.stringify({ title: row.title,
        startDate: row.startDate.toISOString().slice(0, 10), finishDate: row.finishDate.toISOString().slice(0, 10),
        isMilestone: row.isMilestone, predecessorIds: ids, skillIds: row.skills?.map(skill => skill.skillId) || [] })
      await tx.provenanceEvent.create({ data: {
        entityType: 'Task', entityId: task.id, action: 'WORKING_PLAN_REVISED', actorId: Number(req.actor.sub),
        reason: typeof req.body.reason === 'string' ? req.body.reason.trim() || null : null,
        fromState: snapshot(task, task.predecessors.map(edge => edge.predecessorId)),
        toState: snapshot(updated, predecessors.map(row => row.id))
      } })
      return updated
    })
    res.json(saved)
  } catch (e) { next(e) }
})

router.post('/projects/:projectId/tasks', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: lookup(req.params.projectId) })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    const projectId = project.id
    await requireProject(req.actor, projectId, ['PROJECT_MANAGER'])
    const { taskCode, title, description, startDate, finishDate, isMilestone = false, predecessorIds = [], skillIds = [] } = req.body
    if (typeof taskCode !== 'string' || !/^T\d{3,}$/.test(taskCode) ||
        typeof title !== 'string' || !title.trim()) throw bad('Use a task ID such as T107 and a title')
    if (await prisma.task.findUnique({ where: { sharedId: taskCode } })) {
      throw Object.assign(new Error('Task ID already exists'), { status: 409, code: 'TASK_EXISTS' })
    }
    const { start, finish } = validateTaskDates({ startDate, finishDate, isMilestone })
    const task = await prisma.$transaction(async tx => {
      const ids = await validateSkills(tx, skillIds)
      const created = await tx.task.create({ data: { projectId, sharedId: taskCode, taskCode, title: title.trim(), description, startDate: start, finishDate: finish, isMilestone } })
      if (ids.length) await tx.taskSkill.createMany({ data: ids.map(skillId => ({ taskId: created.id, skillId })) })
      const predecessors = await validateDependencies(tx, projectId, created.id, predecessorIds, created)
      if (predecessors.length) await tx.taskDependency.createMany({ data: predecessors.map(pred => ({ predecessorId: pred.id, successorId: created.id })) })
      return created
    })
    res.status(201).json(task)
  } catch (e) { next(e) }
})

router.post('/tasks/:taskId/inactivate', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: lookup(req.params.taskId) })
    if (!task) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } })
    await requireProject(req.actor, task.projectId, ['PROJECT_MANAGER'])
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason) throw bad('Give a reason for marking the task inactive')
    const saved = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${task.id} FOR UPDATE`
      const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } })
      if (current.status !== 'WORKING') throw Object.assign(new Error('Task is already inactive'), { status: 409, code: 'TASK_INACTIVE' })
      const successors = await tx.taskDependency.count({ where: { predecessorId: task.id, successor: { status: 'WORKING' } } })
      if (successors) throw bad('Remove active successor dependencies before marking this task inactive')
      const result = await tx.task.update({ where: { id: task.id }, data: { status: 'INACTIVE' } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'Task', entityId: task.id, action: 'INACTIVATED',
        fromState: 'WORKING', toState: 'INACTIVE', actorId: Number(req.actor.sub), reason
      } })
      return result
    })
    res.json(saved)
  } catch (error) { next(error) }
})

router.post('/projects/:projectId/baselines', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: lookup(req.params.projectId) })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    const projectId = project.id
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
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
      if (latest && !reason) throw bad('Give a reason for the revised baseline')
      const created = await tx.baseline.create({ data: { projectId, versionNo: (latest?.versionNo ?? 0) + 1, previousBaselineId: latest?.id, approvedById: Number(req.actor.sub), reason: reason || null } })
      await tx.baselineTask.createMany({ data: tasks.map(task => ({ baselineId: created.id, taskId: task.id, taskCode: task.taskCode, title: task.title, startDate: task.startDate, finishDate: task.finishDate, isMilestone: task.isMilestone })) })
      if (dependencies.length) await tx.baselineDependency.createMany({ data: dependencies.map(edge => ({ baselineId: created.id, predecessorId: edge.predecessorId, successorId: edge.successorId })) })
      await tx.$executeRaw`UPDATE "Baseline" SET "sealedAt" = CURRENT_TIMESTAMP WHERE id = ${created.id}`
      return tx.baseline.findUnique({ where: { id: created.id }, include: { tasks: true, dependencies: true } })
    })
    res.status(201).json(baseline)
  } catch (e) { next(e) }
})
module.exports = router
