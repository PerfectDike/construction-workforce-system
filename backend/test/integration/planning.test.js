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
  const baseline = await request(app).post(`/api/projects/${task.projectId}/baselines`).set('Authorization', auth(manager)).send({ reason: 'Initial plan' })
  expect(baseline.status).toBe(201)
  expect(baseline.body.tasks.find(row => row.taskId === task.id).finishDate.slice(0, 10)).toBe('2026-11-06')
  expect(baseline.body.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ successorId: task.id, predecessorId: task.predecessors[0].predecessor.id })]))
  await expect(prisma.baselineTask.update({ where: { baselineId_taskId: { baselineId: baseline.body.id, taskId: task.id } }, data: { title: 'Changed' } })).rejects.toThrow()
  await expect(prisma.baseline.delete({ where: { id: baseline.body.id } })).rejects.toThrow()
})

})
