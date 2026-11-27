const request = require('supertest')
const { app } = require('../src/app')

test('GET /api/health reports the API is running', async () => {
  const response = await request(app).get('/api/health')
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ status: 'ok', message: 'Backend is running' })
})

test('GET /api/capabilities and malformed JSON handling respond safely', async () => {
  const caps = await request(app).get('/api/capabilities')
  expect(caps.status).toBe(200)
  expect(typeof caps.body.mailConfigured).toBe('boolean')

  const badJson = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"broken')
  expect(badJson.status).toBe(400)
  expect(badJson.body.error.code).toBe('INVALID_JSON')
})
