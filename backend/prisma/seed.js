require('dotenv').config()
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const fixture = require('../../data/fictional-construction-projects.json')
const workforce = require('../../data/fictional-workers.json')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const date = value => new Date(`${value}T00:00:00.000Z`)
const roles = { manager: 'PROJECT_MANAGER', site_officer: 'SITE_OFFICER', viewer: 'VIEWER' }

async function main() {
  const hash = await bcrypt.hash('DemoPass123!', 10)
  await prisma.$transaction(async db => {
    for (const name of ['ADMIN', ...Object.values(roles)]) await db.role.upsert({ where: { name }, create: { name }, update: {} })
    const projects = {}
    for (const row of fixture.projects) projects[row.projectId] = await db.project.upsert({
      where: { sharedId: row.projectId }, create: { sharedId: row.projectId, name: row.name, description: row.description }, update: {}
    })
    const users = {}
    for (const row of fixture.users) {
      const membership = fixture.memberships.find(m => m.userId === row.userId)
      const role = await db.role.findUniqueOrThrow({ where: { name: roles[membership.role] } })
      users[row.userId] = await db.user.upsert({ where: { sharedId: row.userId },
        create: { sharedId: row.userId, loginLabel: row.email, passwordHash: hash, roleId: role.id }, update: {} })
    }
    for (const row of fixture.memberships) {
      const userId = users[row.userId].id, projectId = projects[row.projectId].id
      await db.projectMembership.upsert({ where: { userId_projectId: { userId, projectId } },
        create: { userId, projectId, roleName: roles[row.role] }, update: {} })
    }
    const skills = {}
    const skillNames = new Set([...fixture.tasks.map(t => t.requiredSkill).filter(Boolean), ...workforce.workers.flatMap(w => w.skills)])
    for (const name of skillNames) skills[name] = await db.skill.upsert({ where: { name }, create: { name }, update: {} })
    const tasks = {}
    for (const row of fixture.tasks) {
      const projectId = projects[row.projectId].id
      const plan = fixture.baselineTasks.find(p => p.taskId === row.taskId)
      tasks[row.taskId] = await db.task.upsert({ where: { sharedId: row.taskId },
        create: { sharedId: row.taskId, projectId, taskCode: row.taskId, title: row.name, startDate: date(plan.plannedStart), finishDate: date(plan.plannedFinish), isMilestone: row.isMilestone }, update: {} })
      if (row.requiredSkill) {
        const taskId = tasks[row.taskId].id, skillId = skills[row.requiredSkill].id
        await db.taskSkill.upsert({ where: { taskId_skillId: { taskId, skillId } }, create: { taskId, skillId }, update: {} })
      }
    }
    for (const row of fixture.tasks) for (const predecessor of row.predecessorTaskIds) {
      const predecessorId = tasks[predecessor].id, successorId = tasks[row.taskId].id
      await db.taskDependency.upsert({ where: { predecessorId_successorId: { predecessorId, successorId } }, create: { predecessorId, successorId }, update: {} })
    }
    const workers = {}
    for (const row of workforce.workers) {
      workers[row.workerId] = await db.worker.upsert({ where: { sharedId: row.workerId },
        create: { sharedId: row.workerId, label: row.name, dailyCapacityHours: 8 }, update: {} })
      for (const name of row.skills) {
        const workerId = workers[row.workerId].id, skillId = skills[name].id
        await db.workerSkill.upsert({ where: { workerId_skillId: { workerId, skillId } }, create: { workerId, skillId }, update: {} })
      }
    }
    for (const row of workforce.availability) {
      const workerId = workers[row.workerId].id, workDate = date(row.date)
      await db.workerAvailability.upsert({ where: { workerId_workDate: { workerId, workDate } }, create: { workerId, workDate, availableHours: row.availableHours }, update: {} })
    }
  })
  for (const model of ['project', 'task', 'worker']) {
    const rows = await prisma[model].findMany({ where: { sharedId: { not: null } }, select: { id: true, sharedId: true }, orderBy: { sharedId: 'asc' } })
    console.log(`${model}s (${rows.length}): ${rows.map(r => `${r.sharedId}=${r.id}`).join(', ')}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
