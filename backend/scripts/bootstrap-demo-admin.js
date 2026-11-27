require('dotenv').config({ quiet: true })
const bcrypt = require('bcryptjs')
const { prisma } = require('../src/db')

async function main() {
  const loginLabel = process.env.CWS_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.CWS_ADMIN_INITIAL_PASSWORD
  if (!loginLabel || !/^[a-z0-9._%+-]+@example\.test$/.test(loginLabel) ||
      !password || password.length < 12 || password.length > 256) {
    throw new Error('Set CWS_ADMIN_EMAIL to a fictional @example.test address and CWS_ADMIN_INITIAL_PASSWORD to at least 12 characters')
  }
  const role = await prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} })
  const existing = await prisma.user.findUnique({ where: { loginLabel } })
  if (existing) {
    if (existing.roleId !== role.id) throw new Error('The configured email belongs to a non-admin account')
    console.log(`Admin account already exists: ${loginLabel}. Password unchanged.`)
    return
  }
  await prisma.user.create({ data: { loginLabel, passwordHash: await bcrypt.hash(password, 12), roleId: role.id } })
  console.log(`Created demo administrator: ${loginLabel}`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
