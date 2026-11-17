function toDate(value) {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid calendar date')
  return date
}

function validateTaskDates({ startDate, finishDate, isMilestone = false }) {
  const start = toDate(startDate)
  const finish = toDate(finishDate)
  if (finish < start) throw new Error('Finish date cannot be before start date')
  if (isMilestone && finish.valueOf() !== start.valueOf()) {
    throw new Error('A milestone must use one calendar date')
  }
  return { start, finish }
}

function assertAcyclic(edges) {
  const graph = new Map()
  for (const { predecessorId, successorId } of edges) {
    if (predecessorId === successorId) throw new Error('A task cannot depend on itself')
    if (!graph.has(predecessorId)) graph.set(predecessorId, [])
    graph.get(predecessorId).push(successorId)
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('Circular dependency rejected')
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of graph.get(id) ?? []) visit(next)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
}

function varianceInDays(actualFinish, baselineFinish) {
  if (!actualFinish || !baselineFinish) return null
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.round((toDate(actualFinish) - toDate(baselineFinish)) / millisecondsPerDay)
}

module.exports = { assertAcyclic, toDate, validateTaskDates, varianceInDays }
