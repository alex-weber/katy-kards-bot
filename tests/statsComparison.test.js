// Period-over-period comparison behind the dashboard's mini-stat cards:
// the selected period against the equivalent stretch of the one before it.

const mockStore = new Map()
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()

jest.mock('../src/controller/redis', () => ({
    cachePrefix: 'test:',
    redis: {
        json: {
            get: jest.fn(async key => (mockStore.has(key) ? mockStore.get(key) : null)),
            set: jest.fn(async (key, _path, value) => { mockStore.set(key, value) }),
        },
        expire: jest.fn(async () => {}),
    },
}))

jest.mock('../src/database/prisma', () => ({
    prisma: {
        message: { findMany: mockFindMany, findFirst: mockFindFirst, groupBy: jest.fn(), count: jest.fn() },
        user: { findMany: jest.fn() },
    },
    Prisma: { join: values => values },
}))

const {
    getStatsComparison,
    periodComparisonWindows,
    percentChange,
} = require('../src/database/message')

const iso = date => date.toISOString().split('T')[0]
const windows = (period, now) => {
    const result = periodComparisonWindows(period, new Date(now))
    return result && {
        current: [iso(result.current.from), iso(result.current.to)],
        previous: [iso(result.previous.from), iso(result.previous.to)],
    }
}

describe('periodComparisonWindows', () => {
    test('current month compares its completed days with the same days of last month', () => {
        // Oct 7: today is still filling up, so 1–6 Oct is set against 1–6 Sep.
        expect(windows('current-month', '2026-10-07T05:00:00Z')).toEqual({
            current: ['2026-10-01', '2026-10-06'],
            previous: ['2026-09-01', '2026-09-06'],
        })
    })

    test('current month has nothing to compare on the 1st', () => {
        expect(windows('current-month', '2026-10-01T05:00:00Z')).toBeNull()
    })

    test('current month is capped at the length of a shorter previous month', () => {
        expect(windows('current-month', '2026-03-31T05:00:00Z')).toEqual({
            current: ['2026-03-01', '2026-03-30'],
            previous: ['2026-02-01', '2026-02-28'],
        })
    })

    test('current month in January compares with December of the year before', () => {
        expect(windows('current-month', '2026-01-10T05:00:00Z')).toEqual({
            current: ['2026-01-01', '2026-01-09'],
            previous: ['2025-12-01', '2025-12-09'],
        })
    })

    test('last month is compared whole against the month before', () => {
        expect(windows('last-month', '2026-10-07T05:00:00Z')).toEqual({
            current: ['2026-09-01', '2026-09-30'],
            previous: ['2026-08-01', '2026-08-31'],
        })
        expect(windows('last-month', '2026-01-15T05:00:00Z')).toEqual({
            current: ['2025-12-01', '2025-12-31'],
            previous: ['2025-11-01', '2025-11-30'],
        })
    })

    test('this year runs to yesterday against the same days of last year', () => {
        expect(windows('current-year', '2026-10-07T05:00:00Z')).toEqual({
            current: ['2026-01-01', '2026-10-06'],
            previous: ['2025-01-01', '2025-10-06'],
        })
        expect(windows('current-year', '2026-01-01T05:00:00Z')).toBeNull()
    })

    test('this year falls back to 28 Feb when last year had no 29 Feb', () => {
        expect(windows('current-year', '2024-03-01T05:00:00Z')).toEqual({
            current: ['2024-01-01', '2024-02-29'],
            previous: ['2023-01-01', '2023-02-28'],
        })
    })

    test('last year is compared whole against the year before', () => {
        expect(windows('last-year', '2026-10-07T05:00:00Z')).toEqual({
            current: ['2025-01-01', '2025-12-31'],
            previous: ['2024-01-01', '2024-12-31'],
        })
    })

    test.each(['all-time', 'daily'])('%s has no previous period', period => {
        expect(windows(period, '2026-10-07T05:00:00Z')).toBeNull()
    })
})

describe('percentChange', () => {
    test('is relative to the previous period, rounded to one decimal', () => {
        expect(percentChange(508, 500)).toBe(1.6)
        expect(percentChange(95, 100)).toBe(-5)
        expect(percentChange(100, 100)).toBe(0)
    })

    test('is null without a baseline', () => {
        expect(percentChange(5, 0)).toBeNull()
        expect(percentChange(0, 0)).toBeNull()
    })
})

describe('getStatsComparison', () => {
    const rows = []
    const add = (day, count, screenshot = false) => {
        for (let i = 0; i < count; i++) rows.push({createdAt: new Date(day + 'T12:00:00Z'), screenshot})
    }

    beforeEach(() => {
        jest.useFakeTimers({now: new Date('2026-10-07T05:00:00Z')})
        mockStore.clear()
        rows.length = 0
        mockFindFirst.mockImplementation(async () => ({createdAt: new Date('2026-09-01T00:00:00Z')}))
        // Screenshot commands are queried with an OR filter; plain messages without one.
        mockFindMany.mockImplementation(async ({where}) => rows.filter(row =>
            row.createdAt >= where.createdAt.gte
            && row.createdAt <= where.createdAt.lte
            && (!where.OR || row.screenshot)))
    })

    afterEach(() => jest.useRealTimers())

    test('compares the completed days of this month with the same days of last month', async () => {
        add('2026-09-02', 500)                // previous window
        add('2026-09-20', 999)                // outside the previous window
        add('2026-10-03', 508)                // current window
        add('2026-10-07', 40)                 // today: still filling up, left out
        add('2026-09-02', 60, true)
        add('2026-10-03', 57, true)

        const result = await getStatsComparison({period: 'current-month'})

        expect(result.available).toBe(true)
        expect(result.current).toEqual({from: '2026-10-01', to: '2026-10-06'})
        expect(result.previous).toEqual({from: '2026-09-01', to: '2026-09-06'})
        expect(result.messages).toEqual({current: 565, previous: 560, change: 0.9})
        expect(result.screenshotCommands).toEqual({current: 57, previous: 60, change: -5})
    })

    test('a previous period with no activity has no relative change', async () => {
        add('2026-10-03', 10)

        const result = await getStatsComparison({period: 'current-month'})

        expect(result.messages).toEqual({current: 10, previous: 0, change: null})
    })

    test('all-time is reported as unavailable', async () => {
        expect(await getStatsComparison({period: 'all-time'})).toEqual({period: 'all-time', available: false})
    })

    test('an unknown period falls back to the current month', async () => {
        expect((await getStatsComparison({period: 'weekly'})).period).toBe('current-month')
    })
})
