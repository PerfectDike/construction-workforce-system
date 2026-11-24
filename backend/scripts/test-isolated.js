require('dotenv').config({ quiet: true })
const { Client } = require('pg')
const { randomBytes } = require('crypto')
const { readdirSync } = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const allSuites = readdirSync(path.join(root, 'test', 'integration'))
  .filter(name => name.endsWith('.test.js')).sort()
const requested = process.argv.slice(2)
if (requested.some(name => !allSuites.includes(name))) throw new Error('Unknown integration test file')
const suites = requested.length ? requested : allSuites
const baseUrl = process.env.DATABASE_URL
if (!baseUrl) throw new Error('DATABASE_URL is required')

function run(label, args, env) {
  process.stdout.write(`\n$ ${label}\n`)
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} exited with ${result.status}`)
}

async function queryAdmin(statement) {
  const client = new Client({ connectionString: baseUrl })
  try { await client.connect(); await client.query(statement) }
  finally { await client.end() }
}

async function main() {
  let failures = 0
  for (const suite of suites) {
    const name = `cw_test_${randomBytes(6).toString('hex')}`
    if (!/^cw_test_[a-f0-9]{12}$/.test(name)) throw new Error('Invalid temporary database name')
    const url = new URL(baseUrl)
    url.pathname = `/${name}`
    const env = { ...process.env, DATABASE_URL: url.toString(),
      JWT_SECRET: randomBytes(32).toString('hex'), RUN_DB_TESTS: '1',
      RUN_CONNECTED_TESTS: '1' }
    process.stdout.write(`\nFresh isolated database for ${suite}: ${name}\n`)
    await queryAdmin(`CREATE DATABASE "${name}"`)
    try {
      run('prisma migrate deploy', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], env)
      run('node prisma/seed.js', [path.join(root, 'prisma', 'seed.js')], env)
      run(`jest ${suite}`, [path.join(root, 'node_modules', 'jest', 'bin', 'jest.js'), '--runInBand', '--runTestsByPath', `test/integration/${suite}`], env)
    } catch (error) {
      failures++
      process.stderr.write(`${suite}: ${error.message}\n`)
    } finally {
      await queryAdmin(`DROP DATABASE "${name}" WITH (FORCE)`)
    }
  }
  if (failures) throw new Error(`${failures} integration suite(s) failed`)
  process.stdout.write(`\nAll ${suites.length} integration suites passed on separate fresh databases.\n`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
