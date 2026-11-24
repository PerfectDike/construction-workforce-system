const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { createHash, randomBytes } = require('crypto')
const { prisma } = require('../db')
const { captureMail } = require('../services/test-mail')
const recoveryRequests = new Map()
const genericRecoveryMessage = 'If the account exists, a reset link has been sent to its demo mailbox.'
const hashToken = token => createHash('sha256').update(token).digest('hex')

async function login(req, res, next) {
  try {
    const { loginLabel, password } = req.body
    const user = await prisma.user.findUnique({ where: { loginLabel }, include: { role: true } })
    if (!user || user.accountStatus !== 'ACTIVE' || typeof password !== 'string' ||
        !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid sign-in details' } })
    }
    const token = jwt.sign({ sub: user.id, role: user.role.name }, process.env.JWT_SECRET, { expiresIn: '1h' })
    return res.json({ token, user: { id: user.id, loginLabel: user.loginLabel, role: user.role.name } })
  } catch (error) { next(error) }
}

async function requestRecovery(req, res, next) {
  try {
    const startedAt = Date.now()
    const loginLabel = typeof req.body.loginLabel === 'string'
      ? req.body.loginLabel.trim().toLowerCase() : ''
    if (!loginLabel || loginLabel.length > 254) {
      return res.status(422).json({ error: { code: 'INVALID_ACCOUNT', message: 'Enter a valid account email' } })
    }
    const key = hashToken(loginLabel + ':' + req.ip)
    const now = Date.now()
    const recent = (recoveryRequests.get(key) || []).filter(time => now - time < 15 * 60 * 1000)
    if (recent.length < 3) {
      recent.push(now)
      recoveryRequests.set(key, recent)
      const user = await prisma.user.findUnique({ where: { loginLabel } })
      if (user) {
        const token = randomBytes(32).toString('hex')
        const codeHash = hashToken(token)
        await prisma.recoveryCode.create({ data: {
          userId: user.id, codeHash, expiresAt: new Date(now + 30 * 60 * 1000)
        } })
        const resetLink = new URL(process.env.RECOVERY_BASE_URL || 'http://localhost:5173/')
        if (process.env.NODE_ENV === 'production' && resetLink.protocol !== 'https:') {
          throw new Error('Recovery URL must use HTTPS in production')
        }
        resetLink.searchParams.set('resetToken', token)
        await captureMail({ to: user.recoveryContact || user.loginLabel, kind: 'password-reset', link: resetLink.toString() })
        await prisma.provenanceEvent.create({ data: {
          entityType: 'User', entityId: user.id, action: 'RECOVERY_REQUESTED',
          actorId: user.id
        } })
      }
    }
    const remaining = 200 - (Date.now() - startedAt)
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
    res.json({ message: genericRecoveryMessage })
  } catch (error) { next(error) }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
        typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
      return res.status(422).json({ error: { code: 'INVALID_RESET', message: 'Enter a valid reset link and a password of at least 12 characters' } })
    }
    const code = await prisma.recoveryCode.findFirst({ where: { codeHash: hashToken(token) } })
    if (!code) return res.status(422).json({ error: { code: 'INVALID_RESET', message: 'Reset link is invalid or expired' } })
    const passwordHash = await bcrypt.hash(newPassword, 10)
    const user = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "RecoveryCode" WHERE id = ${code.id} FOR UPDATE`
      const current = await tx.recoveryCode.findUniqueOrThrow({ where: { id: code.id } })
      if (current.usedAt || current.expiresAt <= new Date()) {
        throw Object.assign(new Error('Reset link is invalid or expired'), { status: 422, code: 'INVALID_RESET' })
      }
      await tx.recoveryCode.update({ where: { id: code.id }, data: { usedAt: new Date() } })
      const saved = await tx.user.update({ where: { id: current.userId }, data: { passwordHash } })
      await tx.provenanceEvent.create({ data: {
        entityType: 'User', entityId: saved.id, action: 'RECOVERY_COMPLETED',
        actorId: saved.id
      } })
      return saved
    })
    await captureMail({ to: user.recoveryContact || user.loginLabel, kind: 'password-reset-complete' })
    res.json({ message: 'Password reset. You can sign in with the new password.' })
  } catch (error) { next(error) }
}

module.exports = { login, requestRecovery, resetPassword }
