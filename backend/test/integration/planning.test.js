const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('planning with a seeded test database', () => {
let manager, outsider, task
const auth = token => `Bearer ${token}`
beforeAll(async () => {
  const login = await request(app).post('/api/auth/login').send({ loginLabel: 'morgan.ellis@example.test', password: 'DemoPass123!' })
  manager = login.body.token
  const other = await request(app).post('/api/auth/login').send({ loginLabel: 'jordan.bell@example.test', password: 'DemoPass123!' })
  outsider = other.body.token
})
afterAll(async () => prisma.$disconnect())
test('lists only the selected project tasks for a member', async () => {
  const visible = await request(app).get('/api/projects/P001/tasks').set('Authorization', auth(manager))
  expect(visible.status).toBe(200)
  expect(visible.body.tasks).toHaveLength(6)
  expect(visible.body.tasks.map(row => row.sharedId)).toContain('T102')
  expect(visible.body.tasks.find(row => row.sharedId === 'T102')).toMatchObject({
    startDate: '2026-11-04T00:00:00.000Z', finishDate: '2026-11-06T00:00:00.000Z',
    isMilestone: false, predecessorIds: ['T101']
  })
  const denied = await request(app).get('/api/projects/P001/tasks').set('Authorization', auth(outsider))
  expect(denied.status).toBe(403)
})
test('save and reopen T102, reject an invalid predecessor, and preserve an approved baseline', async () => {
  expect(manager).toBeTruthy()
  const loaded = await request(app).get('/api/tasks/T102').set('Authorization', auth(manager))
  expect(loaded.status).toBe(200)
  task = loaded.body
  expect(task.predecessors[0].predecessor.sharedId).toBe('T101')
  const denied = await request(app).get('/api/tasks/T102').set('Authorization', auth(outsider))
  expect(denied.status).toBe(403)
  const invalid = await request(app).patch('/api/tasks/T102').set('Authorization', auth(manager)).send({ predecessorIds: ['T201'] })
  expect(invalid.status).toBe(422)
  const saved = await request(app).patch('/api/tasks/T102').set('Authorization', auth(manager)).send({ predecessorIds: ['T101'] })
  expect(saved.status).toBe(200)
  const history = (await request(app).get('/api/tasks/T102/workflow').set('Authorization', auth(manager))).body.planHistory
  expect(history[0]).toMatchObject({ action: 'WORKING_PLAN_REVISED', actor: { loginLabel: 'morgan.ellis@example.test' } })
  expect(JSON.parse(history[0].toState).predecessorIds).toEqual([task.predecessors[0].predecessor.id])
  const baseline = await request(app).post('/api/projects/P001/baselines').set('Authorization', auth(manager)).send({ reason: 'Initial plan' })
  expect(baseline.status).toBe(201)
  const comparison = (await request(app).get('/api/tasks/T102/workflow').set('Authorization', auth(manager))).body.baselines[0]
  expect(comparison).toMatchObject({ versionNo: 1, predecessorIds: ['T101'], taskSnapshot: { title: 'Install drainage' } })
  expect(baseline.body.tasks.find(row => row.taskId === task.id).finishDate.slice(0, 10)).toBe('2026-11-06')
  expect(baseline.body.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ successorId: task.id, predecessorId: task.predecessors[0].predecessor.id })]))
  await expect(prisma.baselineTask.update({ where: { baselineId_taskId: { baselineId: baseline.body.id, taskId: task.id } }, data: { title: 'Changed' } })).rejects.toThrow()
  await expect(prisma.baseline.delete({ where: { id: baseline.body.id } })).rejects.toThrow()

  const assignment = await request(app).post('/api/allocations').set('Authorization', auth(manager))
    .send({ workerId: 'W001', taskId: 'T102', workDate: '2026-11-04', hours: 6 })
  expect(assignment.status).toBe(201)

  const conflict = await request(app).patch('/api/tasks/T102').set('Authorization', auth(manager))
    .send({ startDate: '2026-11-05', predecessorIds: [] })
  expect(conflict.status).toBe(422)
  expect(conflict.body.error.message).toBe(`The proposed dates exclude allocation ${assignment.body.id} for Alex Morgan on 2026-11-04.`)
  expect(await prisma.provenanceEvent.count({ where: { entityType: 'Task', entityId: task.id, action: 'WORKING_PLAN_REVISED' } })).toBe(1)
  const unchanged = await request(app).get('/api/tasks/T102').set('Authorization', auth(manager))
  expect(unchanged.status).toBe(200)
  expect(unchanged.body.startDate).toBe(task.startDate)
  expect(unchanged.body.finishDate).toBe(task.finishDate)
  expect(unchanged.body.predecessors).toEqual(task.predecessors)

  const revised = await request(app).patch('/api/tasks/T102').set('Authorization', auth(manager))
    .send({ finishDate: '2026-11-05' })
  expect(revised.status).toBe(200)
  const nextBaseline = await request(app).post(`/api/projects/${task.projectId}/baselines`).set('Authorization', auth(manager))
    .send({ reason: 'Shorten T102 while keeping its allocation' })
  expect(nextBaseline.status).toBe(201)
  expect(nextBaseline.body).toMatchObject({ versionNo: baseline.body.versionNo + 1, previousBaselineId: baseline.body.id })
  expect(nextBaseline.body.tasks.find(row => row.taskId === task.id).finishDate.slice(0, 10)).toBe('2026-11-05')
  const oldReport = await request(app).get('/api/reports/tasks/T102').query({ baselineId: baseline.body.id })
    .set('Authorization', auth(manager))
  expect(oldReport.status).toBe(200)
  expect(oldReport.body.baselineFinish.slice(0, 10)).toBe('2026-11-06')
  const original = await prisma.baseline.findUniqueOrThrow({
    where: { id: baseline.body.id },
    include: { tasks: true, dependencies: true }
  })
  expect(JSON.parse(JSON.stringify(original.tasks))).toEqual(expect.arrayContaining(baseline.body.tasks))
  expect(original.dependencies).toEqual(expect.arrayContaining(baseline.body.dependencies))
})

test('creates a dated task, rejects affected successor changes and keeps inactive task history', async () => {
  const send = body => request(app).post('/api/projects/P001/tasks')
    .set('Authorization', auth(manager)).send(body)
  const proposal = { taskCode: 'T107', title: 'Check drainage outlet',
    startDate: '2026-11-04', finishDate: '2026-11-04', predecessorIds: [] }
  expect((await send({ ...proposal, startDate: '2026-02-30' })).status).toBe(422)
  expect((await send({ ...proposal, finishDate: '2026-11-03' })).status).toBe(422)
  expect((await send({ ...proposal, finishDate: '2026-11-05', isMilestone: true })).status).toBe(422)
  const created = await send(proposal)
  expect(created.status).toBe(201)
  expect(created.body).toMatchObject({ sharedId: 'T107', taskCode: 'T107', status: 'WORKING' })
  expect((await send(proposal)).status).toBe(409)
  expect((await request(app).patch('/api/tasks/T101').set('Authorization', auth(manager))
    .send({ finishDate: '2026-11-04' })).status).toBe(422)
  expect((await request(app).post('/api/tasks/T101/inactivate').set('Authorization', auth(manager))
    .send({ reason: 'Attempt with active successor' })).status).toBe(422)
  expect((await request(app).post(`/api/projects/${task.projectId}/baselines`).set('Authorization', auth(manager))
    .send({})).status).toBe(422)
  const approved = await request(app).post(`/api/projects/${task.projectId}/baselines`)
    .set('Authorization', auth(manager)).send({ reason: 'Add drainage outlet check' })
  expect(approved.status).toBe(201)
  expect(approved.body.tasks.some(row => row.taskId === created.body.id)).toBe(true)
  const allocated = await request(app).post('/api/allocations').set('Authorization', auth(manager))
    .send({ workerId: 'W001', taskId: 'T107', workDate: '2026-11-04', hours: 1 })
  expect(allocated.status).toBe(201)
  expect((await request(app).post('/api/tasks/T107/inactivate').set('Authorization', auth(outsider))
    .send({ reason: 'Outsider attempt' })).status).toBe(403)
  const inactive = await request(app).post('/api/tasks/T107/inactivate').set('Authorization', auth(manager))
    .send({ reason: 'Outlet check no longer needed' })
  expect(inactive.status).toBe(200)
  expect(inactive.body.status).toBe('INACTIVE')
  expect((await request(app).get('/api/tasks/T107').set('Authorization', auth(manager))).body.status).toBe('INACTIVE')
  expect((await request(app).post('/api/allocations').set('Authorization', auth(manager))
    .send({ workerId: 'W001', taskId: 'T107', workDate: '2026-11-04', hours: 1 })).body.error.code).toBe('TASK_INACTIVE')
  expect((await prisma.allocation.findUniqueOrThrow({ where: { id: allocated.body.id } })).status).toBe('APPROVED')
  const after = await request(app).post(`/api/projects/${task.projectId}/baselines`)
    .set('Authorization', auth(manager)).send({ reason: 'Exclude inactive outlet task' })
  expect(after.status).toBe(201)
  expect(after.body.tasks.some(row => row.taskId === created.body.id)).toBe(false)
  expect((await prisma.baselineTask.findUniqueOrThrow({
    where: { baselineId_taskId: { baselineId: approved.body.id, taskId: created.body.id } }
  })).taskCode).toBe('T107')
})

})
