const { prisma } = require('../db')

async function requireProject(actor, projectId, allowedRoles = []) {
  const userId = Number(actor.sub)
  if (!Number.isInteger(userId)) throw Object.assign(new Error('Invalid account'), { status: 401 })
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } })
  if (!user || user.accountStatus !== 'ACTIVE') throw Object.assign(new Error('Account is unavailable'), { status: 403 })
  if (user.role.name === 'ADMIN') return
  const membership = await prisma.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId } } })
  const role = membership?.roleName || user.role.name
  if (!membership || (allowedRoles.length && !allowedRoles.includes(role))) {
    throw Object.assign(new Error('You do not have permission for this project'), { status: 403 })
  }
}
module.exports = { requireProject }
