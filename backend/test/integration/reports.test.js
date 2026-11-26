const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const { createT102Allocation } = require('../helpers/t102')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('reports for the connected scenario', () => {
  let manager, officer, viewer, t102Allocation, t102Update
  const api = (verb, url, token) => request(app)[verb](url).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    for (const [email, assign] of [['casey.lane@example.test', x => officer = x], ['morgan.ellis@example.test', x => manager = x], ['robin.dale@example.test', x => viewer = x]]) {
      const response = await request(app).post('/api/auth/login').send({ loginLabel: email, password: 'DemoPass123!' })
      expect(response.status).toBe(200)
      assign(response.body.token)
    }
    t102Allocation = await createT102Allocation(api, manager)
    const submitted = await api('post', '/api/site-updates', officer).send({
      allocationId: t102Allocation.id, workDate: '2026-11-04', recordedHours: 3, actualFinishDate: '2026-11-09'
    })
    expect(submitted.status).toBe(201)
    t102Update = submitted.body
    const approved = await api('post', `/api/site-updates/${t102Update.id}/approve`, manager).send({})
    expect(approved.status).toBe(200)
  }, 30000)
  afterAll(async () => prisma.$disconnect())
  test('shows variance and source records, and distinguishes zero from missing', async () => {
    const report = await api('get', '/api/reports/tasks/T102', viewer)
    expect(report.status).toBe(200)
    expect(report.body).toMatchObject({ taskId: 'T102', finishVarianceDays: 3, plannedHours: 6, recordedHours: 3, hoursStatus: 'reported' })
    expect(report.body.sources.allocationIds).toEqual([t102Allocation.id])
    expect(report.body.sources.updateIds).toEqual([t102Update.id])
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

  test('lists only permitted projects and traces a project period report to records', async () => {
    const projects = await api('get', '/api/projects', viewer)
    expect(projects.status).toBe(200)
    expect(projects.body.projects.map(project => project.sharedId)).toEqual(['P001'])
    const managerProjects = await api('get', '/api/projects', manager)
    expect(managerProjects.body.projects.map(project => project.sharedId)).toEqual(['P001', 'P002'])
    expect((await api('get', '/api/projects/P001/baselines', viewer)).body.baselines).toHaveLength(1)

    const report = await api('get', '/api/reports/projects/P001?asOf=2026-11-12&from=2026-11-01&to=2026-11-12', viewer)
    expect(report.status).toBe(200)
    expect(report.body.totals).toMatchObject({ taskCount: 6, plannedHours: 11, recordedHours: 3, reportedTaskCount: 2 })
    const finished = report.body.tasks.find(row => row.taskId === 'T102')
    expect(finished).toMatchObject({ status: 'finished', finishVarianceDays: 3, plannedHours: 6, recordedHours: 3, hoursStatus: 'reported' })
    expect(finished.sources.allocations.map(row => row.id)).toEqual([t102Allocation.id])
    expect(finished.sources.updates.map(row => row.id)).toEqual([t102Update.id])
    expect(report.body.tasks.find(row => row.taskId === 'T103')).toMatchObject({ recordedHours: 0, hoursStatus: 'reported' })
    expect(report.body.tasks.find(row => row.taskId === 'T104')).toMatchObject({ recordedHours: null, hoursStatus: 'not_reported' })
    expect((await api('get', '/api/reports/projects/P002?asOf=2026-11-12', viewer)).status).toBe(403)
    expect((await api('get', '/api/projects/P002/baselines', viewer)).status).toBe(403)
  })

  test('selects an approved baseline and validates report dates', async () => {
    const first = await api('get', '/api/reports/projects/P001?asOf=2026-11-12', manager)
    expect(first.status).toBe(200)
    const beforeWork = await api('get', '/api/reports/projects/P001?asOf=2026-11-03', manager)
    expect(beforeWork.status).toBe(200)
    expect(beforeWork.body.tasks.find(row => row.taskId === 'T102')).toMatchObject({
      status: 'not_reported', recordedHours: null, actualFinish: null
    })
    const saved = await api('patch', '/api/tasks/T102', manager).send({ finishDate: '2026-11-05' })
    expect(saved.status).toBe(200)
    const approved = await api('post', `/api/projects/${first.body.project.id}/baselines`, manager).send({ reason: 'Updated drainage finish' })
    expect(approved.status).toBe(201)
    const oldReport = await api('get', `/api/reports/projects/P001?asOf=2026-11-12&baselineId=${first.body.baseline.id}`, manager)
    const newReport = await api('get', '/api/reports/projects/P001?asOf=2026-11-12', manager)
    expect(oldReport.body.tasks.find(row => row.taskId === 'T102').finishVarianceDays).toBe(3)
    expect(newReport.body.tasks.find(row => row.taskId === 'T102').finishVarianceDays).toBe(4)
    for (const query of ['asOf=2026-02-30', 'from=2026-11-13&to=2026-11-12', 'asOf=2026-11-03&to=2026-11-04', 'baselineId=abc']) {
      expect((await api('get', `/api/reports/projects/P001?${query}`, manager)).status).toBe(422)
    }
  })
})

