const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const request = require('supertest')
const { app } = require('../../src/app')
const { prisma } = require('../../src/db')
const dbSuite = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip

dbSuite('fictional account recovery', () => {
  let mailbox
  const resetRequest = loginLabel => request(app).post('/api/auth/recovery/request').send({ loginLabel })
  const messages = async () => {
    const files = await fs.readdir(mailbox)
    return Promise.all(files.map(async file => JSON.parse(await fs.readFile(path.join(mailbox, file), 'utf8'))))
  }
  beforeAll(async () => {
    mailbox = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-test-mail-'))
    process.env.TEST_MAILBOX_DIR = mailbox
  })
  afterAll(async () => {
    await prisma.$disconnect()
    if (mailbox.startsWith(path.join(os.tmpdir(), 'cw-test-mail-'))) await fs.rm(mailbox, { recursive: true, force: true })
    delete process.env.TEST_MAILBOX_DIR
  })

  test('unknown address has the same response; a valid link is single-use and preserves viewer rights', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginLabel: 'robin.dale@example.test' }, include: { memberships: true }
    })
    const unknown = await resetRequest('nobody@example.test')
    const known = await resetRequest('robin.dale@example.test')
    expect(unknown.status).toBe(200)
    expect(known.status).toBe(200)
    expect(unknown.body).toEqual(known.body)
    const sent = (await messages()).filter(mail => mail.kind === 'password-reset')
    expect(sent).toHaveLength(1)
    const token = new URL(sent[0].link).searchParams.get('resetToken')
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    const stored = await prisma.recoveryCode.findFirstOrThrow({ where: { userId: user.id } })
    expect(stored.codeHash).not.toBe(token)
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await request(app).post('/api/auth/recovery/reset')
      .send({ token: '0'.repeat(64), newPassword: 'NewDemoPass123!' })).status).toBe(422)
    const reset = await request(app).post('/api/auth/recovery/reset')
      .send({ token, newPassword: 'NewDemoPass123!' })
    expect(reset.status).toBe(200)
    expect((await request(app).post('/api/auth/recovery/reset')
      .send({ token, newPassword: 'AnotherPass123!' })).status).toBe(422)
    expect((await request(app).post('/api/auth/login')
      .send({ loginLabel: user.loginLabel, password: 'DemoPass123!' })).status).toBe(401)
    const login = await request(app).post('/api/auth/login')
      .send({ loginLabel: user.loginLabel, password: 'NewDemoPass123!' })
    expect(login.status).toBe(200)
    expect(login.body.user.role).toBe('VIEWER')
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id }, include: { memberships: true }
    })
    expect(after.roleId).toBe(user.roleId)
    expect(after.memberships).toEqual(user.memberships)
    const events = await prisma.provenanceEvent.findMany({ where: { entityType: 'User', entityId: user.id } })
    expect(events.map(event => event.action)).toEqual(['RECOVERY_REQUESTED', 'RECOVERY_COMPLETED'])
    expect(JSON.stringify(events)).not.toContain(token)
    expect((await messages()).some(mail => mail.kind === 'password-reset-complete')).toBe(true)
  })

  test('expired links fail and repeated requests are limited', async () => {
    const label = 'morgan.ellis@example.test'
    for (let i = 0; i < 4; i++) expect((await resetRequest(label)).status).toBe(200)
    const sent = (await messages()).filter(mail => mail.kind === 'password-reset' && mail.to === label)
    expect(sent).toHaveLength(3)
    const token = new URL(sent[0].link).searchParams.get('resetToken')
    const user = await prisma.user.findUniqueOrThrow({ where: { loginLabel: label } })
    await prisma.recoveryCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } })
    expect((await request(app).post('/api/auth/recovery/reset')
      .send({ token, newPassword: 'NewDemoPass123!' })).status).toBe(422)
    expect((await request(app).post('/api/auth/login')
      .send({ loginLabel: label, password: 'DemoPass123!' })).status).toBe(200)
  })
})
