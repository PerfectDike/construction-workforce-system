const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('allocations with a seeded test database', () => {
  let token
  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ loginLabel: 'morgan.ellis@example.test', password: 'DemoPass123!' })
    token = login.body.token
    for (const sharedId of ['P001', 'P002']) {
      const project = await prisma.project.findUnique({ where: { sharedId } })
      if (!await prisma.baseline.findFirst({ where: { projectId: project.id } })) {
        const response = await request(app).post(`/api/projects/${project.id}/baselines`).set('Authorization', `Bearer ${token}`).send({ reason: 'Initial plan' })
        if (response.status !== 201) throw Error(JSON.stringify(response.body))
      }
    }
  })
  afterAll(async () => prisma.$disconnect())
  test('accepts eight hours across projects and rejects a ninth and missing skills', async () => {
    const send = body => request(app).post('/api/allocations').set('Authorization', `Bearer ${token}`).send(body)
    const base = { workerId: 'W001', workDate: '2026-11-04' }
    expect((await send({ ...base, taskId: 'T102', hours: 6 })).status).toBe(201)
    expect((await send({ ...base, taskId: 'T201', hours: 2 })).status).toBe(201)
    const extra = await send({ ...base, taskId: 'T102', hours: 1 })
    expect(extra.status).toBe(422)
    expect(extra.body.error.code).toBe('OVER_CAPACITY')
    const missing = await send({ workerId: 'W002', taskId: 'T103', workDate: '2026-11-11', hours: 1 })
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe('SKILL_MISMATCH')
    const total = await prisma.allocation.aggregate({ where: { worker: { sharedId: 'W001' }, workDate: new Date('2026-11-04T00:00:00.000Z'), status: 'APPROVED' }, _sum: { allocatedHours: true } })
    expect(Number(total._sum.allocatedHours)).toBe(8)
  })
})


