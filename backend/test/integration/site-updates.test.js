const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('site-update approval with the connected allocation', () => {
  let officer, manager, viewer, allocation
  const api = (verb, url, token) => request(app)[verb](url).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    for (const [email, assign] of [['casey.lane@example.test', x => officer = x], ['morgan.ellis@example.test', x => manager = x], ['robin.dale@example.test', x => viewer = x]]) {
      const response = await request(app).post('/api/auth/login').send({ loginLabel: email, password: 'DemoPass123!' })
      assign(response.body.token)
    }
    allocation = await prisma.allocation.findFirstOrThrow({ where: { task: { sharedId: 'T102' }, worker: { sharedId: 'W001' }, workDate: new Date('2026-11-04T00:00:00Z') } })
  })
  afterAll(async () => prisma.$disconnect())
  test('a correction is pending until a manager approves it; a viewer can read', async () => {
    const original = await api('post', '/api/site-updates', officer).send({ allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 4 })
    expect(original.status).toBe(201)
    expect((await api('post', `/api/site-updates/${original.body.id}/approve`, officer).send({})).status).toBe(403)
    expect((await api('post', `/api/site-updates/${original.body.id}/approve`, manager).send({})).status).toBe(200)
    const corrected = await api('post', '/api/site-updates', officer).send({ allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 3, actualFinishDate: '2026-11-09', supersedesId: original.body.id })
    expect(corrected.status).toBe(201)
    let result = await api('get', '/api/tasks/T102/site-updates', viewer)
    expect(result.status).toBe(200)
    expect(result.body.map(x => Number(x.recordedHours))).toEqual([4])
    expect((await api('post', `/api/site-updates/${corrected.body.id}/approve`, manager).send({})).status).toBe(200)
    result = await api('get', '/api/tasks/T102/site-updates', viewer)
    expect(result.body.map(x => Number(x.recordedHours))).toEqual([3])
    expect((await prisma.siteUpdate.findUnique({ where: { id: original.body.id } })).status).toBe('SUPERSEDED')
  })
})

