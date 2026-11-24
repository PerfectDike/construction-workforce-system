const fs = require('fs/promises')
const path = require('path')
const { randomUUID } = require('crypto')

async function captureMail(message) {
  if (process.env.NODE_ENV === 'production') throw new Error('A real mail transport is required in production')
  const directory = process.env.TEST_MAILBOX_DIR || path.join(process.cwd(), '.test-mail')
  await fs.mkdir(directory, { recursive: true })
  const filename = path.join(directory, `${Date.now()}-${randomUUID()}.json`)
  await fs.writeFile(filename, JSON.stringify({ ...message, capturedAt: new Date().toISOString() }), {
    encoding: 'utf8', mode: 0o600, flag: 'wx'
  })
}

module.exports = { captureMail }
