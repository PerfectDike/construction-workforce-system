const { assertAcyclic, validateTaskDates, varianceInDays } = require('../../src/services/planning')

test('rejects finish before start', () => expect(() => validateTaskDates({ startDate: '2026-06-16', finishDate: '2026-06-12' })).toThrow('Finish date'))
test('rejects a circular dependency', () => expect(() => assertAcyclic([{ predecessorId: 1, successorId: 2 }, { predecessorId: 2, successorId: 1 }])).toThrow('Circular'))
test('calculates four calendar days of variance', () => expect(varianceInDays('2026-06-16', '2026-06-12')).toBe(4))
test('reports missing variance as null', () => expect(varianceInDays(null, '2026-06-12')).toBeNull())
