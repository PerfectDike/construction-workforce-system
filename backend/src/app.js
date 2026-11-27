const express = require('express')
const cors = require('cors')
const { login, requestRecovery, resetPassword } = require('./routes/auth')
const planning = require('./routes/planning')
const allocations = require('./routes/allocations')
const updates = require('./routes/site-updates')
const reports = require('./routes/reports')
const accounts = require('./routes/accounts')
const setup = require('./routes/setup')

const app = express()
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})
app.use(cors())
app.use(express.json())
app.get('/api/health', (_req, res) => res.json({ status: 'ok', message: 'Backend is running' }))
app.get('/api/capabilities', (_req, res) => res.json({ mailConfigured: process.env.NODE_ENV !== 'production' }))
app.post('/api/auth/login', login)
app.post('/api/auth/recovery/request', requestRecovery)
app.post('/api/auth/recovery/reset', resetPassword)
app.use('/api', planning)
app.use('/api', allocations)
app.use('/api', updates)
app.use('/api', reports)
app.use('/api', accounts)
app.use('/api', setup)
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } })
  }
  const known = /Finish date|milestone|Circular dependency/.test(error?.message || '')
  const status = error.status ?? (known ? 422 : 500)
  const code = error.code || (known || status === 422 ? 'VALIDATION_ERROR' : status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR')
  if (status >= 500) {
    console.error('[api-error]', error)
    const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (error?.message || 'Internal server error')
    return res.status(status).json({ error: { code, message } })
  }
  res.status(status).json({ error: { code, message: error.message } })
})
app.app = app
module.exports = app

