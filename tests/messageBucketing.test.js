// Tests the chart bucketing (daily / weekly / monthly) in message.js by
// driving getDashboardMessages with a past `to` (so only the cached historical
// slice runs) and mocked Prisma rows.

const mockStore = new Map()
const mockFindMany = jest.fn()

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

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn(() => ({
        message: { findMany: mockFindMany, groupBy: jest.fn(), count: jest.fn() },
        user: { findMany: jest.fn() },
        $disconnect: jest.fn(),
    })),
}))

const { getDashboardMessages } = require('../src/database/message')

const rows = (...isoDates) => isoDates.map(d => ({ createdAt: new Date(d) }))

beforeEach(() => {
    mockStore.clear()
    mockFindMany.mockReset()
})

describe('bucketDailyCounts via getDashboardMessages', () => {
    test('returns an empty array when there are no messages', async () => {
        mockFindMany.mockResolvedValue([])
        const series = await getDashboardMessages({ from: '2024-06-01', to: '2024-06-10' })
        expect(series).toEqual([])
    })

    test('daily granularity for short spans, with zero-filled gaps', async () => {
        mockFindMany.mockResolvedValue(
            rows('2024-06-01T10:00:00Z', '2024-06-01T11:00:00Z', '2024-06-03T09:00:00Z')
        )
        const series = await getDashboardMessages({ from: '2024-06-01', to: '2024-06-10' })
        expect(series).toEqual([
            { label: '01/06', count: 2 },
            { label: '02/06', count: 0 },
            { label: '03/06', count: 1 },
        ])
    })

    test('weekly granularity for spans between two months and a year', async () => {
        // ~90 day span => weekly buckets (Monday-keyed, "DD/MM - DD/MM" labels)
        mockFindMany.mockResolvedValue(rows('2024-01-01T00:00:00Z', '2024-03-25T00:00:00Z'))
        const series = await getDashboardMessages({ from: '2024-01-01', to: '2024-03-31' })
        expect(series.length).toBeGreaterThan(8) // many weeks
        expect(series[0].label).toMatch(/\d{2}\/\d{2} - \d{2}\/\d{2}/)
        const total = series.reduce((s, b) => s + b.count, 0)
        expect(total).toBe(2)
    })

    test('monthly granularity for spans over a year', async () => {
        mockFindMany.mockResolvedValue(rows('2023-01-15T00:00:00Z', '2024-06-20T00:00:00Z'))
        const series = await getDashboardMessages({ from: '2023-01-01', to: '2024-06-30' })
        expect(series[0].label).toBe('2023-01')
        expect(series[series.length - 1].label).toBe('2024-06')
        const total = series.reduce((s, b) => s + b.count, 0)
        expect(total).toBe(2)
        // Jan 2023 .. Jun 2024 inclusive = 18 monthly buckets
        expect(series).toHaveLength(18)
    })
})
