const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const { createT102Allocation } = require('../helpers/t102')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('site-update approval with the connected allocation', () => {
  let officer, manager, viewer, allocation
  const api = (verb, url, token) => request(app)[verb](url).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    for (const [email, assign] of [['casey.lane@example.test', x => officer = x], ['morgan.ellis@example.test', x => manager = x], ['robin.dale@example.test', x => viewer = x]]) {
      const response = await request(app).post('/api/auth/login').send({ loginLabel: email, password: 'DemoPass123!' })
      assign(response.body.token)
    }
    allocation = await createT102Allocation(api, manager)
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
  test('rejects a correction without changing the report, then withdraws a later approval', async () => {
    const current = await prisma.siteUpdate.findFirstOrThrow({
      where: { allocationId: allocation.id, status: 'APPROVED', isCurrent: true }
    })
    const duplicate = await api('post', '/api/site-updates', officer)
      .send({ allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 2 })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('DUPLICATE_UPDATE')

    const submit = () => api('post', '/api/site-updates', officer)
      .send({ allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 2, supersedesId: current.id })
    const correction = await submit()
    expect(correction.status).toBe(201)
    expect((await api('post', `/api/site-updates/${correction.body.id}/reject`, manager).send({})).status).toBe(422)
    expect((await api('post', `/api/site-updates/${correction.body.id}/reject`, viewer)
      .send({ reason: 'Viewer attempt' })).status).toBe(403)
    const rejected = await api('post', `/api/site-updates/${correction.body.id}/reject`, manager)
      .send({ reason: 'Hours need correction' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('REJECTED')
    let report = await api('get', '/api/reports/tasks/T102', viewer)
    expect(report.status).toBe(200)
    expect(report.body.recordedHours).toBe(3)

    const next = await submit()
    expect(next.status).toBe(201)
    expect((await api('post', `/api/site-updates/${next.body.id}/approve`, manager).send({})).status).toBe(200)
    report = await api('get', '/api/reports/tasks/T102', viewer)
    expect(report.body.recordedHours).toBe(2)

    expect((await api('post', `/api/site-updates/${next.body.id}/withdraw`, manager).send({})).status).toBe(422)
    expect((await api('post', `/api/site-updates/${next.body.id}/withdraw`, viewer)
      .send({ reason: 'Viewer attempt' })).status).toBe(403)
    const withdrawn = await api('post', `/api/site-updates/${next.body.id}/withdraw`, manager)
      .send({ reason: 'Entry withdrawn after review' })
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.body).toMatchObject({ status: 'WITHDRAWN', isCurrent: false })
    report = await api('get', '/api/reports/tasks/T102', viewer)
    expect(report.body.recordedHours).toBeNull()
    expect(report.body.hoursStatus).toBe('not_reported')
    const events = await prisma.provenanceEvent.findMany({
      where: { entityType: 'SiteUpdate', entityId: { in: [correction.body.id, next.body.id] } }
    })
    expect(events.map(event => event.action)).toEqual(expect.arrayContaining(['REJECTED', 'APPROVED', 'WITHDRAWN']))
    expect(events.filter(event => ['REJECTED', 'WITHDRAWN'].includes(event.action))
      .every(event => event.actorId && event.occurredAt && event.reason)).toBe(true)
    const event = events.find(row => row.action === 'WITHDRAWN')
    await expect(prisma.provenanceEvent.update({
      where: { id: event.id }, data: { reason: 'Changed after decision' }
    })).rejects.toThrow()
    await expect(prisma.provenanceEvent.delete({ where: { id: event.id } })).rejects.toThrow()
    expect(await prisma.provenanceEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      actorId: event.actorId, action: event.action, reason: event.reason, occurredAt: event.occurredAt
    })
  })
  test('validates progressPercent and reports unfinished/overdue tasks accurately', async () => {
    for (const badPct of [-1, 101, 12.5]) {
      expect((await api('post', '/api/site-updates', officer).send({
        allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 2, progressPercent: badPct
      })).status).toBe(422)
    }
    const inProgress = await api('post', '/api/site-updates', officer).send({
      allocationId: allocation.id, workDate: '2026-11-04', recordedHours: 2, progressPercent: 45
    })
    expect(inProgress.status).toBe(201)
    expect(inProgress.body.progressPercent).toBe(45)
    expect((await api('post', `/api/site-updates/${inProgress.body.id}/approve`, manager).send({})).status).toBe(200)

    const projectReport = await api('get', '/api/reports/projects/P001?asOf=2026-11-12&from=2026-11-01&to=2026-11-12', viewer)
    expect(projectReport.status).toBe(200)
    const t102 = projectReport.body.tasks.find(row => row.taskId === 'T102')
    expect(t102).toMatchObject({ status: 'unfinished', overdue: true, recordedHours: 2, progressPercent: 45 })
    expect(projectReport.body.totals).toMatchObject({ finished: 0, unfinished: 1, overdue: 1 })

    const blockedEdit = await api('patch', `/api/allocations/${allocation.id}`, manager).send({
      workerId: 'W001', workDate: '2026-11-04', hours: 5, reason: 'Try changing while update exists'
    })
    expect(blockedEdit.status).toBe(409)
    expect(blockedEdit.body.error.code).toBe('ALLOCATION_HAS_UPDATES')

    const blockedCancel = await api('post', `/api/allocations/${allocation.id}/cancel`, manager).send({
      reason: 'Try cancelling while update exists'
    })
    expect(blockedCancel.status).toBe(409)
    expect(blockedCancel.body.error.code).toBe('ALLOCATION_HAS_UPDATES')
  })
})

