const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip

dbSuite('database safeguards against direct writes', () => {
  afterAll(async () => prisma.$disconnect())
  test('rejects invalid dates, baseline changes, invalid hours and approval bypasses', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ loginLabel: 'morgan.ellis@example.test', password: 'DemoPass123!' })
    expect(login.status).toBe(200)
    const manager = await prisma.user.findUniqueOrThrow({ where: { loginLabel: 'morgan.ellis@example.test' } })
    const officer = await prisma.user.findUniqueOrThrow({ where: { loginLabel: 'casey.lane@example.test' } })
    const project = await prisma.project.findUniqueOrThrow({ where: { sharedId: 'P001' } })
    const task = await prisma.task.findUniqueOrThrow({ where: { sharedId: 'T102' } })
    const worker = await prisma.worker.findUniqueOrThrow({ where: { sharedId: 'W001' } })
    const baseline = await request(app).post(`/api/projects/${project.id}/baselines`)
      .set('Authorization', `Bearer ${login.body.token}`).send({ reason: 'Direct safeguard check' })
    expect(baseline.status).toBe(201)

    await expect(prisma.$executeRaw`UPDATE "Task" SET "finishDate" = '2026-11-03' WHERE id = ${task.id}`).rejects.toThrow(/task_date_order/)
    await expect(prisma.$executeRaw`UPDATE "Task" SET "isMilestone" = true WHERE id = ${task.id}`).rejects.toThrow(/task_date_order/)
    await expect(prisma.$executeRaw`UPDATE "Baseline" SET "reason" = 'Changed' WHERE id = ${baseline.body.id}`).rejects.toThrow(/read-only/)
    await expect(prisma.$executeRaw`DELETE FROM "Baseline" WHERE id = ${baseline.body.id}`).rejects.toThrow(/read-only/)
    await expect(prisma.$executeRaw`UPDATE "BaselineTask" SET "title" = 'Changed' WHERE "baselineId" = ${baseline.body.id} AND "taskId" = ${task.id}`).rejects.toThrow(/read-only/)
    const newTask = await prisma.task.create({ data: {
      projectId: project.id, sharedId: 'T107', taskCode: 'T107', title: 'Snapshot insert check',
      startDate: new Date('2026-11-04T00:00:00Z'), finishDate: new Date('2026-11-04T00:00:00Z')
    } })
    await expect(prisma.$executeRaw`
      INSERT INTO "BaselineTask" ("baselineId","taskId","taskCode","title","startDate","finishDate","isMilestone")
      VALUES (${baseline.body.id},${newTask.id},'T107','Later insertion','2026-11-04','2026-11-04',false)
    `).rejects.toThrow(/Approved baseline snapshots are read-only/)
    await expect(prisma.$executeRaw`
      INSERT INTO "BaselineDependency" ("baselineId","predecessorId","successorId")
      VALUES (${baseline.body.id},${task.id},${newTask.id})
    `).rejects.toThrow(/Approved baseline snapshots are read-only/)
    await expect(prisma.baseline.create({ data: {
      projectId: project.id, versionNo: 1, approvedById: manager.id
    } })).rejects.toThrow(/Unique constraint/)
    const draft = await prisma.baseline.create({ data: {
      projectId: project.id, versionNo: 2, approvedById: manager.id
    } })
    await expect(prisma.$executeRaw`
      INSERT INTO "BaselineTask" ("baselineId","taskId","taskCode","title","startDate","finishDate","isMilestone")
      VALUES (${draft.id},${newTask.id},'T107','Bad dates','2026-11-05','2026-11-04',false)
    `).rejects.toThrow(/baseline_task_date_order/)
    await expect(prisma.$executeRaw`
      INSERT INTO "BaselineTask" ("baselineId","taskId","taskCode","title","startDate","finishDate","isMilestone")
      VALUES (${draft.id},${newTask.id},'T107','Bad milestone','2026-11-04','2026-11-05',true)
    `).rejects.toThrow(/baseline_task_date_order/)
    await expect(prisma.allocation.create({ data: {
      taskId: task.id, workerId: worker.id, workDate: new Date('2026-11-04T00:00:00Z'), allocatedHours: 0
    } })).rejects.toThrow(/allocation_positive_hours/)
    const allocation = await prisma.allocation.create({ data: {
      taskId: task.id, workerId: worker.id, workDate: new Date('2026-11-04T00:00:00Z'), allocatedHours: 1
    } })
    const updateData = {
      taskId: task.id, allocationId: allocation.id, workDate: new Date('2026-11-04T00:00:00Z'),
      recordedHours: 1, status: 'APPROVED', isCurrent: true, entryKey: 'direct-check'
    }
    await expect(prisma.siteUpdate.create({ data: {
      ...updateData, authorId: officer.id, approvedById: officer.id
    } })).rejects.toThrow(/site_update_no_self_approval/)
    const approved = await prisma.siteUpdate.create({ data: {
      ...updateData, authorId: officer.id, approvedById: manager.id
    } })
    await expect(prisma.siteUpdate.create({ data: {
      ...updateData, authorId: officer.id, approvedById: manager.id
    } })).rejects.toThrow(/Unique constraint/)
    const event = await prisma.provenanceEvent.create({ data: {
      entityType: 'SiteUpdate', entityId: approved.id, action: 'DIRECT_CHECK', actorId: manager.id
    } })
    await expect(prisma.provenanceEvent.update({ where: { id: event.id }, data: { action: 'CHANGED' } })).rejects.toThrow(/append-only/)
    await expect(prisma.provenanceEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/)
  }, 30000)
})
