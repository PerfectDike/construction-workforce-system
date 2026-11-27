const express = require('express')
const bcrypt = require('bcryptjs')
const { randomBytes } = require('crypto')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')

const router = express.Router()
router.use(requireAuth)
const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }) }
const reference = value => /^\d+$/.test(value) ? { id: Number(value) } : { sharedId: value }

async function admin(actor) {
  const user = await prisma.user.findUnique({ where: { id: Number(actor.sub) }, include: { role: true } })
  if (!user || user.accountStatus !== 'ACTIVE' || user.role.name !== 'ADMIN') fail('Only an administrator can manage project and worker records', 403)
  return user
}

async function nextSharedId(tx, model, prefix) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(1881847463)) AS advisory_lock`
  const rows = await tx[model].findMany({ select: { sharedId: true } })
  const highest = rows.reduce((max, row) => {
    const match = row.sharedId?.match(new RegExp(`^${prefix}(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}${String(highest + 1).padStart(3, '0')}`
}

function skillIds(value) {
  if (!Array.isArray(value) || value.some(id => !Number.isInteger(id) || id < 1) || new Set(value).size !== value.length) fail('Choose valid skills')
  return value
}

async function checkSkills(tx, ids) {
  if (await tx.skill.count({ where: { id: { in: ids } } }) !== ids.length) fail('A selected skill does not exist')
}

router.get('/setup/accounts', async (req, res, next) => {
  try {
    await admin(req.actor)
    const accounts = await prisma.user.findMany({
      where: { accountStatus: 'ACTIVE', role: { name: { not: 'ADMIN' } } },
      select: { id: true, loginLabel: true, sharedId: true, role: { select: { name: true } } },
      orderBy: { loginLabel: 'asc' }
    })
    res.json({ accounts: accounts.map(({ role, ...row }) => ({ ...row, roleName: role.name })) })
  } catch (e) { next(e) }
})

router.post('/setup/accounts', async (req, res, next) => {
  try {
    const actor = await admin(req.actor)
    const loginLabel = typeof req.body.loginLabel === 'string' ? req.body.loginLabel.trim().toLowerCase() : ''
    const roleName = req.body.roleName
    if (!/^[a-z0-9._%+-]+@example\.test$/.test(loginLabel) ||
        !['PROJECT_MANAGER', 'SITE_OFFICER', 'VIEWER'].includes(roleName)) {
      fail('Enter an @example.test email address and choose a role')
    }
    const existing = await prisma.user.findUnique({ where: { loginLabel } })
    if (existing) fail('Account already exists', 409)
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
    const temporaryPassword = `${randomBytes(12).toString('base64url')}A1!`
    const passwordHash = await bcrypt.hash(temporaryPassword, 10)
    const projectRef = typeof req.body.projectId === 'string' && req.body.projectId.trim() ? req.body.projectId.trim() : null
    const project = projectRef ? await prisma.project.findUnique({ where: reference(projectRef) }) : null
    if (projectRef && !project) fail('Project not found', 404)
    const created = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { loginLabel, passwordHash, roleId: role.id } })
      if (project) {
        await tx.projectMembership.create({ data: { userId: user.id, projectId: project.id, roleName } })
      }
      await tx.provenanceEvent.create({ data: {
        entityType: 'User', entityId: user.id, action: 'ACCOUNT_CREATED', actorId: actor.id,
        reason: project ? `${project.sharedId || project.id}:${roleName}` : roleName
      } })
      return user
    })
    res.status(201).json({ id: created.id, loginLabel, roleName, temporaryPassword })
  } catch (e) { next(e) }
})

router.post('/setup/accounts/:userId/reset-password', async (req, res, next) => {
  try {
    const actor = await admin(req.actor)
    const userId = Number(req.params.userId)
    const target = Number.isInteger(userId) ? await prisma.user.findUnique({ where: { id: userId }, include: { role: true } }) : null
    if (!target) fail('Account not found', 404)
    if (target.accountStatus !== 'ACTIVE' || target.role.name === 'ADMIN') fail('Choose an active project account')
    const temporaryPassword = `${randomBytes(12).toString('base64url')}A1!`
    const passwordHash = await bcrypt.hash(temporaryPassword, 10)
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: target.id }, data: { passwordHash } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'User', entityId: target.id, action: 'ADMIN_PASSWORD_RESET', actorId: actor.id
      } })
    })
    res.json({ id: target.id, loginLabel: target.loginLabel, temporaryPassword })
  } catch (e) { next(e) }
})

router.post('/setup/projects', async (req, res, next) => {
  try {
    const actor = await admin(req.actor)
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : ''
    if (!name || name.length > 160 || description.length > 1000) fail('Enter a project name (up to 160 characters) and a shorter description')
    const project = await prisma.$transaction(async tx => {
      const sharedId = await nextSharedId(tx, 'project', 'P')
      const created = await tx.project.create({ data: { sharedId, name, description: description || null } })
      await tx.projectMembership.create({ data: { projectId: created.id, userId: actor.id, roleName: 'ADMIN' } })
      await tx.provenanceEvent.create({ data: { entityType: 'Project', entityId: created.id, action: 'CREATED', actorId: actor.id, toState: JSON.stringify({ sharedId, name }) } })
      return created
    })
    res.status(201).json(project)
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/memberships', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: reference(req.params.projectId) })
    if (!project) fail('Project not found', 404)
    await admin(req.actor)
    const memberships = await prisma.projectMembership.findMany({ where: { projectId: project.id }, include: { user: { select: { id: true, loginLabel: true, sharedId: true } } }, orderBy: { userId: 'asc' } })
    res.json({ memberships: memberships.map(row => ({ ...row.user, roleName: row.roleName })) })
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/pending-updates', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: reference(req.params.projectId) })
    if (!project) fail('Project not found', 404)
    await requireProject(req.actor, project.id, ['PROJECT_MANAGER'])
    const updates = await prisma.siteUpdate.findMany({ where: { task: { projectId: project.id }, status: 'SUBMITTED' },
      select: { id: true, workDate: true, recordedHours: true, progressPercent: true, task: { select: { sharedId: true, title: true } }, author: { select: { loginLabel: true } } }, orderBy: { id: 'asc' } })
    res.json({ updates: updates.map(row => ({ id: row.id, taskId: row.task.sharedId, title: row.task.title,
      workDate: row.workDate, recordedHours: row.recordedHours === null ? null : Number(row.recordedHours),
      progressPercent: row.progressPercent, author: row.author.loginLabel })) })
  } catch (e) { next(e) }
})

router.put('/projects/:projectId/memberships/:userId', async (req, res, next) => {
  try {
    await admin(req.actor)
    const project = await prisma.project.findUnique({ where: reference(req.params.projectId) })
    const userId = Number(req.params.userId)
    const user = Number.isInteger(userId) ? await prisma.user.findUnique({ where: { id: userId }, include: { role: true } }) : null
    if (!project || !user) fail('Project or account not found', 404)
    if (user.accountStatus !== 'ACTIVE' || user.role.name === 'ADMIN') fail('Choose an active project account')
    const roleName = req.body.roleName
    if (!['PROJECT_MANAGER', 'SITE_OFFICER', 'VIEWER'].includes(roleName)) fail('Choose a project role')
    const saved = await prisma.$transaction(async tx => {
      const previous = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId: project.id } } })
      const membership = await tx.projectMembership.upsert({ where: { userId_projectId: { userId, projectId: project.id } }, create: { userId, projectId: project.id, roleName }, update: { roleName } })
      await tx.provenanceEvent.create({ data: { entityType: 'ProjectMembership', entityId: userId, action: previous ? 'ROLE_CHANGED' : 'ASSIGNED', actorId: Number(req.actor.sub), reason: project.sharedId, fromState: previous?.roleName || null, toState: roleName } })
      return membership
    })
    res.json({ userId, projectId: project.sharedId, roleName: saved.roleName })
  } catch (e) { next(e) }
})

router.get('/setup/skills', async (req, res, next) => {
  try {
    await admin(req.actor)
    res.json({ skills: await prisma.skill.findMany({ orderBy: { name: 'asc' } }) })
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/skills', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: reference(req.params.projectId) })
    if (!project) fail('Project not found', 404)
    await requireProject(req.actor, project.id)
    res.json({ skills: await prisma.skill.findMany({ orderBy: { name: 'asc' } }) })
  } catch (e) { next(e) }
})

router.post('/setup/skills', async (req, res, next) => {
  try {
    await admin(req.actor)
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name || name.length > 80) fail('Enter a skill name (up to 80 characters)')
    const skill = await prisma.skill.upsert({ where: { name }, create: { name }, update: {} })
    res.status(201).json(skill)
  } catch (e) { next(e) }
})

router.get('/setup/workers', async (req, res, next) => {
  try {
    await admin(req.actor)
    const workers = await prisma.worker.findMany({ include: { skills: { include: { skill: true } } }, orderBy: { sharedId: 'asc' } })
    res.json({ workers: workers.map(row => ({ id: row.id, sharedId: row.sharedId, label: row.label, dailyCapacityHours: Number(row.dailyCapacityHours), skillIds: row.skills.map(item => item.skillId), skills: row.skills.map(item => item.skill.name) })) })
  } catch (e) { next(e) }
})

router.post('/setup/workers', async (req, res, next) => {
  try {
    await admin(req.actor)
    const label = typeof req.body.label === 'string' ? req.body.label.trim() : ''
    const dailyCapacityHours = Number(req.body.dailyCapacityHours)
    const ids = skillIds(req.body.skillIds)
    if (!label || label.length > 120 || !Number.isFinite(dailyCapacityHours) || dailyCapacityHours <= 0 || dailyCapacityHours > 24 || Math.round(dailyCapacityHours * 100) !== dailyCapacityHours * 100) fail('Enter a worker name and a daily capacity from 0.01 to 24 hours')
    const worker = await prisma.$transaction(async tx => {
      const sharedId = await nextSharedId(tx, 'worker', 'W')
      await checkSkills(tx, ids)
      const created = await tx.worker.create({ data: { sharedId, label, dailyCapacityHours, skills: { create: ids.map(skillId => ({ skillId })) } } })
      await tx.provenanceEvent.create({ data: { entityType: 'Worker', entityId: created.id, action: 'CREATED', actorId: Number(req.actor.sub), toState: JSON.stringify({ sharedId, label, dailyCapacityHours, skillIds: ids }) } })
      return created
    })
    res.status(201).json({ sharedId: worker.sharedId, label: worker.label, dailyCapacityHours: Number(worker.dailyCapacityHours), skillIds: ids })
  } catch (e) { next(e) }
})

router.patch('/setup/workers/:workerId', async (req, res, next) => {
  try {
    await admin(req.actor)
    const worker = await prisma.worker.findUnique({ where: reference(req.params.workerId), include: { skills: true } })
    if (!worker) fail('Worker not found', 404)
    const label = req.body.label === undefined ? worker.label : String(req.body.label).trim()
    const dailyCapacityHours = req.body.dailyCapacityHours === undefined ? Number(worker.dailyCapacityHours) : Number(req.body.dailyCapacityHours)
    const ids = req.body.skillIds === undefined ? worker.skills.map(row => row.skillId) : skillIds(req.body.skillIds)
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason) fail('Give a reason for the worker change')
    if (!label || label.length > 120 || !Number.isFinite(dailyCapacityHours) || dailyCapacityHours <= 0 || dailyCapacityHours > 24 || Math.round(dailyCapacityHours * 100) !== dailyCapacityHours * 100) fail('Enter a worker name and a valid daily capacity')
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${worker.id} FOR UPDATE`
      await checkSkills(tx, ids)
      const before = await tx.worker.findUniqueOrThrow({ where: { id: worker.id }, include: { skills: true } })
      await tx.workerSkill.deleteMany({ where: { workerId: worker.id } })
      if (ids.length) await tx.workerSkill.createMany({ data: ids.map(skillId => ({ workerId: worker.id, skillId })) })
      const saved = await tx.worker.update({ where: { id: worker.id }, data: { label, dailyCapacityHours } })
      const allocations = await tx.allocation.findMany({ where: { workerId: worker.id, status: 'APPROVED' }, include: { task: { include: { skills: true, project: true } }, worker: { include: { availability: true } } }, orderBy: { id: 'asc' } })
      const impactedAllocations = allocations.filter(row => row.task.skills.some(skill => !ids.includes(skill.skillId)) ||
        allocations.filter(other => other.workDate.getTime() === row.workDate.getTime()).reduce((sum, other) => sum + Number(other.allocatedHours), 0) > Math.min(dailyCapacityHours, Number(row.worker.availability.find(day => day.workDate.getTime() === row.workDate.getTime())?.availableHours ?? 0)))
        .map(row => ({ allocationId: row.id, projectId: row.task.project.sharedId, taskId: row.task.sharedId, workDate: row.workDate.toISOString().slice(0, 10) }))
      await tx.provenanceEvent.create({ data: { entityType: 'Worker', entityId: worker.id, action: 'PROFILE_CHANGED', actorId: Number(req.actor.sub), reason, fromState: JSON.stringify({ label: before.label, dailyCapacityHours: Number(before.dailyCapacityHours), skillIds: before.skills.map(row => row.skillId) }), toState: JSON.stringify({ label, dailyCapacityHours, skillIds: ids }) } })
      return { sharedId: saved.sharedId, label, dailyCapacityHours, skillIds: ids, impactedAllocations }
    })
    res.json(result)
  } catch (e) { next(e) }
})

module.exports = router
