const express = require('express')
const cors = require('cors')
const { login } = require('./routes/auth')
const planning = require('./routes/planning')
const allocations = require('./routes/allocations')
const updates = require('./routes/site-updates')

const app = express()
app.use(cors())
app.use(express.json())
app.get('/api/health', (_req, res) => res.json({ status: 'ok', message: 'Backend is running' }))
app.post('/api/auth/login', login)
app.use('/api', planning)
app.use('/api', allocations)
app.use('/api', updates)
app.use((error, _req, res, _next) => {
  const known = /Finish date|milestone|Circular dependency/.test(error.message)
  const status = error.status ?? (known ? 422 : 500)
  res.status(status).json({ error: { code: error.code || (known || status === 422 ? 'VALIDATION_ERROR' : status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR'), message: error.message } })
})
module.exports = { app }

