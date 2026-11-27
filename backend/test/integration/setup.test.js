const request = require('supertest')
const bcrypt = require('bcryptjs')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')

const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip
dbSuite('project and worker setup', () => {
  let adminToken, managerToken, viewerToken
  const api = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } })
    await prisma.user.create({ data: { loginLabel: 'setup.admin@example.test', passwordHash: await bcrypt.hash('FictionalAdmin123!', 10), roleId: role.id } })
    for (const [email, assign] of [
      ['setup.admin@example.test', token => adminToken = token],
      ['morgan.ellis@example.test', token => managerToken = token],
      ['robin.dale@example.test', token => viewerToken = token]
    ]) {
      const login = await request(app).post('/api/auth/login').send({ loginLabel: email,
        password: email.startsWith('setup.') ? 'FictionalAdmin123!' : 'DemoPass123!' })
      expect(login.status).toBe(200)
      assign(login.body.token)
    }
  })
  afterAll(async () => prisma.$disconnect())

  test('only admin creates a project and assigns an existing account', async () => {
    const input = { name: 'Harbour retaining wall', description: 'Fictional demonstration project' }
    expect((await api('post', '/api/setup/projects', managerToken).send(input)).status).toBe(403)
    const created = await api('post', '/api/setup/projects', adminToken).send(input)
    expect(created.body).toMatchObject({ sharedId: 'P003' })
    expect(created.status).toBe(201)
    expect(created.body.sharedId).toBe('P003')
    const manager = await prisma.user.findUniqueOrThrow({ where: { loginLabel: 'morgan.ellis@example.test' } })
    expect((await api('put', `/api/projects/P003/memberships/${manager.id}`, managerToken).send({ roleName: 'PROJECT_MANAGER' })).status).toBe(403)
    const assigned = await api('put', `/api/projects/P003/memberships/${manager.id}`, adminToken).send({ roleName: 'PROJECT_MANAGER' })
    expect(assigned.status).toBe(200)
    expect((await api('get', '/api/projects', managerToken)).body.projects.map(row => row.sharedId)).toContain('P003')
    expect((await api('get', '/api/projects/P003/memberships', viewerToken)).status).toBe(403)
  })

  test('skill and worker IDs feed activity allocation eligibility', async () => {
    const skill = await api('post', '/api/setup/skills', adminToken).send({ name: 'Retaining wall formwork' })
    expect(skill.status).toBe(201)
    expect((await api('post', '/api/setup/workers', viewerToken).send({ label: 'Taylor Reed', dailyCapacityHours: 8, skillIds: [skill.body.id] })).status).toBe(403)
    const worker = await api('post', '/api/setup/workers', adminToken).send({ label: 'Taylor Reed', dailyCapacityHours: 8, skillIds: [skill.body.id] })
    expect(worker.body).toMatchObject({ sharedId: 'W005' })
    expect(worker.status).toBe(201)
    expect(worker.body.sharedId).toBe('W005')
    const activity = await api('post', '/api/projects/P003/tasks', managerToken).send({ taskCode: 'T301', title: 'Install retaining wall formwork', startDate: '2026-10-01', finishDate: '2026-10-03', skillIds: [skill.body.id] })
    expect(activity.status).toBe(201)
    expect((await prisma.taskSkill.findMany({ where: { taskId: activity.body.id } })).map(row => row.skillId)).toEqual([skill.body.id])
    const baseline = await api('post', '/api/projects/P003/baselines', managerToken).send({})
    expect(baseline.status).toBe(201)
    const options = await api('get', '/api/tasks/T301/workforce-options?date=2026-10-02', managerToken)
    expect(options.status).toBe(200)
    const selected = options.body.workers.find(row => row.workerId === 'W005')
    expect(selected.flags).toContain('AVAILABILITY_UNKNOWN')
    expect(selected.flags).not.toContain('SKILL_MISMATCH')
    const availability = await api('patch', '/api/projects/P003/workers/W005/availability/2026-10-02', managerToken).send({ availableHours: 8, reason: 'Fictional worker is available' })
    expect(availability.status).toBe(200)
    const allocation = await api('post', '/api/allocations', managerToken).send({ taskId: 'T301', workerId: 'W005', workDate: '2026-10-02', hours: 6 })
    expect(allocation.status).toBe(201)
    const otherSkill = await api('post', '/api/setup/skills', adminToken).send({ name: 'Survey setting out' })
    const rejectedSkillChange = await api('patch', '/api/tasks/T301', managerToken).send({ skillIds: [skill.body.id, otherSkill.body.id] })
    expect(rejectedSkillChange.status).toBe(422)
    const revised = await api('patch', '/api/setup/workers/W005', adminToken).send({ skillIds: [], reason: 'Demonstrate a changed worker profile' })
    expect(revised.status).toBe(200)
    expect(revised.body.impactedAllocations.map(row => row.allocationId)).toEqual([allocation.body.id])
    const after = await api('get', '/api/tasks/T301/workforce-options?date=2026-10-02', managerToken)
    expect(after.body.workers.find(row => row.workerId === 'W005').flags).toContain('SKILL_MISMATCH')
  })

  test('admin provisions an account with one-time password, normalizes login, and resets password', async () => {
    const payload = { loginLabel: 'officer.two@example.test', roleName: 'SITE_OFFICER', projectId: 'P003' }
    expect((await api('post', '/api/setup/accounts', managerToken).send(payload)).status).toBe(403)
    const created = await api('post', '/api/setup/accounts', adminToken).send(payload)
    expect(created.status).toBe(201)
    expect(typeof created.body.temporaryPassword).toBe('string')
    const mixedCaseLogin = await request(app).post('/api/auth/login').send({
      loginLabel: '  Officer.Two@Example.Test ',
      password: created.body.temporaryPassword
    })
    expect(mixedCaseLogin.status).toBe(200)
    expect((await api('get', '/api/tasks/T301/workflow', mixedCaseLogin.body.token)).body.permissions.submitHours).toBe(true)

    const rotated = await api('post', `/api/setup/accounts/${created.body.id}/reset-password`, adminToken).send({})
    expect(rotated.status).toBe(200)
    expect((await request(app).post('/api/auth/login').send({
      loginLabel: 'officer.two@example.test', password: created.body.temporaryPassword
    })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({
      loginLabel: 'officer.two@example.test', password: rotated.body.temporaryPassword
    })).status).toBe(200)
  })
})
