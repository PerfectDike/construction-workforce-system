const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('reports for the connected scenario', () => {
  let manager, officer, viewer
  const api = (verb, url, token) => request(app)[verb](url).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    for (const [email, assign] of [['casey.lane@example.test', x => officer = x], ['morgan.ellis@example.test', x => manager = x], ['robin.dale@example.test', x => viewer = x]]) {
      const response = await request(app).post('/api/auth/login').send({ loginLabel: email, password: 'DemoPass123!' }); assign(response.body.token)
    }
  })
  afterAll(async () => prisma.$disconnect())
  test('shows variance and source records, and distinguishes zero from missing', async () => {
    const report = await api('get', '/api/reports/tasks/T102', viewer)
    expect(report.status).toBe(200)
    expect(report.body).toMatchObject({ taskId: 'T102', finishVarianceDays: 3, plannedHours: 6, recordedHours: 3, hoursStatus: 'reported' })
    expect(report.body.sources.allocationIds).toHaveLength(1)
    expect(report.body.sources.updateIds).toHaveLength(1)
    const missing = await api('get', '/api/reports/tasks/T103', viewer)
    expect(missing.body.recordedHours).toBeNull()
    expect(missing.body.hoursStatus).toBe('not_reported')
    const allocation = await api('post', '/api/allocations', manager).send({ workerId: 'W003', taskId: 'T103', workDate: '2026-11-11', hours: 5 })
    expect(allocation.status).toBe(201)
    const zero = await api('post', '/api/site-updates', officer).send({ allocationId: allocation.body.id, workDate: '2026-11-11', recordedHours: 0 })
    expect(zero.status).toBe(201)
    expect((await api('post', `/api/site-updates/${zero.body.id}/approve`, manager).send({})).status).toBe(200)
    const shown = await api('get', '/api/reports/tasks/T103', viewer)
    expect(shown.body.recordedHours).toBe(0)
    expect(shown.body.hoursStatus).toBe('reported')
  })
})

