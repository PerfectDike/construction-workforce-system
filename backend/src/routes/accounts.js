const express = require('express')
const bcrypt = require('bcryptjs')
const { randomBytes } = require('crypto')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { requireProject } = require('../middleware/project-access')
const { captureMail } = require('../services/test-mail')

const router = express.Router()
router.use(requireAuth)

router.post('/projects/:projectId/accounts', async (req, res, next) => {
  try {
    const reference = req.params.projectId
    const project = await prisma.project.findUnique({
      where: /^\d+$/.test(reference) ? { id: Number(reference) } : { sharedId: reference }
    })
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } })
    await requireProject(req.actor, project.id, ['ADMIN', 'PROJECT_MANAGER'])
    if (process.env.NODE_ENV === 'production') throw Object.assign(new Error('Account invitation needs a mail transport'), { status: 503 })
    const loginLabel = typeof req.body.loginLabel === 'string' ? req.body.loginLabel.trim().toLowerCase() : ''
    const roleName = req.body.roleName
    if (!/^[a-z0-9._%+-]+@example\.test$/.test(loginLabel) ||
        !['PROJECT_MANAGER', 'SITE_OFFICER', 'VIEWER'].includes(roleName)) {
      return res.status(422).json({ error: { code: 'INVALID_ACCOUNT', message: 'Enter a fictional example.test address and a project role' } })
    }
    const existing = await prisma.user.findUnique({ where: { loginLabel } })
    if (existing) return res.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'Account already exists' } })
    const temporaryPassword = randomBytes(18).toString('base64url') + 'A1!'
    const passwordHash = await bcrypt.hash(temporaryPassword, 10)
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
    const actorId = Number(req.actor.sub)
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { loginLabel, passwordHash, roleId: role.id } })
      await tx.projectMembership.create({ data: { userId: created.id, projectId: project.id, roleName } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'User', entityId: created.id, action: 'ACCOUNT_CREATED', actorId,
        reason: `${project.sharedId || project.id}:${roleName}`
      } })
      return created
    })
    await captureMail({ to: loginLabel, kind: 'account-invite', projectId: project.sharedId || project.id, temporaryPassword })
    res.status(201).json({ id: user.id, loginLabel, projectId: project.sharedId || project.id, roleName })
  } catch (error) { next(error) }
})

module.exports = router
