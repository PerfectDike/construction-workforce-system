async function createT102Allocation(api, manager) {
  const task = await api('get', '/api/tasks/T102', manager)
  expect(task.status).toBe(200)
  const baseline = await api('post', `/api/projects/${task.body.projectId}/baselines`, manager)
    .send({ reason: 'Site lifecycle test setup' })
  expect(baseline.status).toBe(201)
  const allocation = await api('post', '/api/allocations', manager)
    .send({ workerId: 'W001', taskId: 'T102', workDate: '2026-11-04', hours: 6 })
  expect(allocation.status).toBe(201)
  return allocation.body
}
module.exports = { createT102Allocation }
