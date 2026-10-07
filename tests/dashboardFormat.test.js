// Formatting helpers of the dashboard's period comparison (src/js/dashboard.js).
// The script is a browser file; outside a browser it only exports these helpers.

const {formatChange, changeDirection, formatDayRange} = require('../src/js/dashboard')

describe('formatChange', () => {
    test('signs the relative change and keeps one decimal when needed', () => {
        expect(formatChange(1.6, 100)).toBe('+1.6 %')
        expect(formatChange(-5, 100)).toBe('−5 %')
        expect(formatChange(12.5, 100)).toBe('+12.5 %')
    })

    test('shows no sign for no change', () => {
        expect(formatChange(0, 100)).toBe('0 %')
    })

    test('without a baseline: "new" if there is activity, otherwise 0 %', () => {
        expect(formatChange(null, 3)).toBe('new')
        expect(formatChange(null, 0)).toBe('0 %')
    })
})

describe('changeDirection', () => {
    test.each([
        [1.6, 5, 'up'],
        [-5, 5, 'down'],
        [0, 5, 'flat'],
        [null, 3, 'up'],
        [null, 0, 'flat'],
    ])('change %p with %p now is %s', (change, current, direction) => {
        expect(changeDirection(change, current)).toBe(direction)
    })
})

describe('formatDayRange', () => {
    test('collapses a range inside one month', () => {
        expect(formatDayRange('2026-10-01', '2026-10-06', 2026)).toBe('1–6 Oct')
        expect(formatDayRange('2026-09-01', '2026-09-06', 2026)).toBe('1–6 Sep')
    })

    test('names both months across a month boundary and a single day alone', () => {
        expect(formatDayRange('2026-01-01', '2026-10-06', 2026)).toBe('1 Jan – 6 Oct')
        expect(formatDayRange('2026-10-06', '2026-10-06', 2026)).toBe('6 Oct')
    })

    test('adds the year when the range is not in the current year', () => {
        expect(formatDayRange('2025-09-01', '2025-09-30', 2026)).toBe('1–30 Sep 2025')
        expect(formatDayRange('2025-01-01', '2025-12-31', 2026)).toBe('1 Jan – 31 Dec 2025')
    })
})
