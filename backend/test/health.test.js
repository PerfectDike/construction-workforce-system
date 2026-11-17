const request = require('supertest')
const { app } = require('../src/app')

test('GET /api/health reports the API is running', async () => {
  const response = await request(app).get('/api/health')
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ status: 'ok', message: 'Backend is running' })
})
