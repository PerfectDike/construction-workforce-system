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
  test('simultaneous requests cannot exceed a worker day', async () => {
    const body = { workerId: 'W001', taskId: 'T104', workDate: '2026-11-09', hours: 5 }
    const results = await Promise.all([
      request(app).post('/api/allocations').set('Authorization', `Bearer ${token}`).send(body),
      request(app).post('/api/allocations').set('Authorization', `Bearer ${token}`).send(body)
    ])
    expect(results.map(result => result.status).sort()).toEqual([201, 422])
    expect(results.find(result => result.status === 422).body.error.code).toBe('OVER_CAPACITY')
    const saved = await prisma.allocation.findMany({
      where: { worker: { sharedId: 'W001' }, task: { sharedId: 'T104' },
        workDate: new Date('2026-11-09T00:00:00.000Z'), status: 'APPROVED' }
    })
    expect(saved).toHaveLength(1)
    expect(Number(saved[0].allocatedHours)).toBe(5)
  })
  test('shows current availability, skill and date flags for manager planning', async () => {
    const url = '/api/tasks/T102/workforce-options?date=2026-11-04'
    const options = await request(app).get(url).set('Authorization', `Bearer ${token}`)
    expect(options.status).toBe(200)
    expect(options.body.workers).toHaveLength(4)
    expect(options.body.workers.find(row => row.workerId === 'W001')).toMatchObject({
      availableHours: 8, committedHours: 8, remainingHours: 0,
      flags: ['FULLY_ALLOCATED'], eligible: false
    })
    expect(options.body.workers.find(row => row.workerId === 'W002').flags)
      .toEqual(expect.arrayContaining(['SKILL_MISMATCH', 'AVAILABILITY_UNKNOWN']))
    expect((await request(app).get('/api/tasks/T102/workforce-options?date=2026-02-30')
      .set('Authorization', `Bearer ${token}`)).status).toBe(422)
    const viewer = await request(app).post('/api/auth/login')
      .send({ loginLabel: 'robin.dale@example.test', password: 'DemoPass123!' })
    expect((await request(app).get(url).set('Authorization', `Bearer ${viewer.body.token}`)).status).toBe(403)
  })
  test('revises and cancels allocations without losing history or exceeding capacity', async () => {
    const original = await prisma.allocation.findFirstOrThrow({
      where: { task: { sharedId: 'T102' }, worker: { sharedId: 'W001' }, status: 'APPROVED' }
    })
    const authorization = 'Bearer ' + token
    const change = (hours, reason = 'Adjust planned hours') =>
      request(app).patch(`/api/allocations/${original.id}`).set('Authorization', authorization)
        .send({ workerId: 'W001', workDate: '2026-11-04', hours, reason })
    const denied = await change(7)
    expect(denied.status).toBe(422)
    expect(denied.body.error.code).toBe('OVER_CAPACITY')
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('APPROVED')

    const viewer = await request(app).post('/api/auth/login')
      .send({ loginLabel: 'robin.dale@example.test', password: 'DemoPass123!' })
    expect(viewer.status).toBe(200)
    const forbidden = await request(app).patch(`/api/allocations/${original.id}`)
      .set('Authorization', 'Bearer ' + viewer.body.token)
      .send({ workerId: 'W001', workDate: '2026-11-04', hours: 5, reason: 'Viewer attempt' })
    expect(forbidden.status).toBe(403)

    const revised = await change(5.5)
    expect(revised.status).toBe(201)
    expect(revised.body.replacesId).toBe(original.id)
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('SUPERSEDED')
    expect(Number(original.allocatedHours)).toBe(6)
    const active = await prisma.allocation.aggregate({
      where: { worker: { sharedId: 'W001' }, workDate: new Date('2026-11-04T00:00:00.000Z'), status: 'APPROVED' },
      _sum: { allocatedHours: true }
    })
    expect(Number(active._sum.allocatedHours)).toBe(7.5)
    expect((await change(5)).status).toBe(409)

    const cancelUrl = `/api/allocations/${revised.body.id}/cancel`
    const attempts = await Promise.all([
      request(app).post(cancelUrl).set('Authorization', authorization).send({ reason: 'Task reassigned' }),
      request(app).post(cancelUrl).set('Authorization', authorization).send({ reason: 'Task reassigned' })
    ])
    expect(attempts.map(result => result.status).sort()).toEqual([200, 409])
    const audit = await prisma.provenanceEvent.findMany({
      where: { entityType: 'Allocation', entityId: { in: [original.id, revised.body.id] } },
      orderBy: { id: 'asc' }
    })
    expect(audit.map(event => event.action)).toEqual(['REVISED', 'CANCELLED'])
    expect(audit.every(event => event.actorId && event.occurredAt && event.reason)).toBe(true)
    const workflow = await request(app).get('/api/tasks/T102/workflow').set('Authorization', authorization)
    expect(workflow.status).toBe(200)
    expect(workflow.body.allocationHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, status: 'SUPERSEDED' }),
      expect.objectContaining({ id: revised.body.id, status: 'CANCELLED' })
    ]))
    const restored = await request(app).post('/api/allocations').set('Authorization', authorization)
      .send({ workerId: 'W001', taskId: String(original.taskId), workDate: '2026-11-04', hours: 6 })
    expect(restored.status).toBe(201)
    expect((await request(app).post(cancelUrl).set('Authorization', 'Bearer ' + viewer.body.token)
      .send({ reason: 'Viewer attempt' })).status).toBe(403)
  })
  test('records a dated availability reduction and identifies affected allocations', async () => {
    const authorization = 'Bearer ' + token
    const endpoint = '/api/projects/P001/workers/W001/availability/2026-11-04'
    const missingReason = await request(app).patch(endpoint).set('Authorization', authorization)
      .send({ availableHours: 7 })
    expect(missingReason.status).toBe(422)
    expect(missingReason.body.error.code).toBe('REASON_REQUIRED')

    const changed = await request(app).patch(endpoint).set('Authorization', authorization)
      .send({ availableHours: 7, reason: 'Training reduces Alex Morgan availability' })
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({
      workerId: 'W001', workDate: '2026-11-04', availableHours: 7,
      capacityHours: 7, allocatedHours: 8, affected: true
    })
    expect(changed.body.impactedAllocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'T102', projectId: 'P001', allocatedHours: 6 }),
      expect.objectContaining({ taskId: 'T201', projectId: 'P002', allocatedHours: 2 })
    ]))
    const options = await request(app).get('/api/tasks/T102/workforce-options?date=2026-11-04')
      .set('Authorization', authorization)
    expect(options.body.workers.find(row => row.workerId === 'W001').flags)
      .toEqual(expect.arrayContaining(['OVER_CAPACITY', 'FULLY_ALLOCATED']))
    const audit = await prisma.provenanceEvent.findFirstOrThrow({
      where: { entityType: 'WorkerAvailability', action: 'AVAILABILITY_CHANGED' }, orderBy: { id: 'desc' }
    })
    expect(audit.reason).toBe('Training reduces Alex Morgan availability')

    const viewer = await request(app).post('/api/auth/login')
      .send({ loginLabel: 'robin.dale@example.test', password: 'DemoPass123!' })
    expect((await request(app).patch(endpoint).set('Authorization', 'Bearer ' + viewer.body.token)
      .send({ availableHours: 8, reason: 'Viewer attempt' })).status).toBe(403)
    expect((await request(app).patch(endpoint).set('Authorization', authorization)
      .send({ availableHours: 24.001, reason: 'Invalid precision' })).status).toBe(422)
  })
})


