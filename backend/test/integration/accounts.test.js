const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip

dbSuite('fictional project accounts', () => {
  let mailbox, manager, officer, viewer
  const api = (verb, url, token) => request(app)[verb](url).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    mailbox = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-account-mail-'))
    process.env.TEST_MAILBOX_DIR = mailbox
    for (const [label, assign] of [
      ['morgan.ellis@example.test', x => manager = x],
      ['casey.lane@example.test', x => officer = x],
      ['robin.dale@example.test', x => viewer = x]
    ]) {
      const response = await request(app).post('/api/auth/login').send({ loginLabel: label, password: 'DemoPass123!' })
      expect(response.status).toBe(200)
      assign(response.body.token)
    }
  })
  afterAll(async () => {
    await prisma.$disconnect()
    if (mailbox.startsWith(path.join(os.tmpdir(), 'cw-account-mail-'))) await fs.rm(mailbox, { recursive: true, force: true })
    delete process.env.TEST_MAILBOX_DIR
  })

  test('manager creates a scoped fictional viewer and invitation without exposing the password in API or provenance', async () => {
    const payload = { loginLabel: 'new.viewer@example.test', roleName: 'VIEWER' }
    expect((await api('post', '/api/projects/P001/accounts', viewer).send(payload)).status).toBe(403)
    expect((await api('post', '/api/projects/P001/accounts', officer).send(payload)).status).toBe(403)
    expect((await api('post', '/api/projects/P001/accounts', manager)
      .send({ loginLabel: 'real@gmail.com', roleName: 'ADMIN' })).status).toBe(422)
    const created = await api('post', '/api/projects/P001/accounts', manager).send(payload)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ loginLabel: payload.loginLabel, projectId: 'P001', roleName: 'VIEWER' })
    expect(created.body).not.toHaveProperty('temporaryPassword')
    expect((await api('post', '/api/projects/P001/accounts', manager).send(payload)).status).toBe(409)
    const files = await fs.readdir(mailbox)
    expect(files).toHaveLength(1)
    const mail = JSON.parse(await fs.readFile(path.join(mailbox, files[0]), 'utf8'))
    expect(mail).toMatchObject({ kind: 'account-invite', to: payload.loginLabel, projectId: 'P001' })
    const login = await request(app).post('/api/auth/login').send({ loginLabel: payload.loginLabel, password: mail.temporaryPassword })
    expect(login.status).toBe(200)
    expect(login.body.user.role).toBe('VIEWER')
    expect((await api('get', '/api/tasks/T102', login.body.token)).status).toBe(200)
    expect((await api('get', '/api/tasks/T202', login.body.token)).status).toBe(403)
    const events = await prisma.provenanceEvent.findMany({ where: { entityType: 'User', entityId: created.body.id } })
    expect(events.map(event => event.action)).toEqual(['ACCOUNT_CREATED'])
    expect(JSON.stringify(events)).not.toContain(mail.temporaryPassword)
  })
})
