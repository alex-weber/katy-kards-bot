const mockStore = new Map()
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockExpire = jest.fn(async () => {})

jest.mock('../src/controller/redis', () => ({
    cachePrefix: 'test:',
    redis: {
        json: {
            get: jest.fn(async key => (mockStore.has(key) ? mockStore.get(key) : null)),
            set: jest.fn(async (key, _path, value) => { mockStore.set(key, value) }),
        },
        expire: mockExpire,
    },
}))

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn(() => ({
        message: { findMany: mockFindMany, findFirst: mockFindFirst, groupBy: jest.fn(), count: jest.fn() },
        user: { findMany: jest.fn() },
        $disconnect: jest.fn(),
    })),
}))

const { getDashboardMessages } = require('../src/database/message')

const rows = (...isoDates) => isoDates.map(createdAt => ({createdAt: new Date(createdAt)}))
const todayIso = () => new Date().toISOString().split('T')[0] + 'T12:00:00Z'

beforeEach(() => {
    mockStore.clear()
    mockFindMany.mockReset()
    mockFindFirst.mockReset()
    mockExpire.mockClear()
})

describe('period buckets via getDashboardMessages', () => {
    test.each([
        ['daily', 30, /^\d{2}\/\d{2}$/],
        ['monthly', 12, /^\d{4}-\d{2}$/],
        ['quarterly', 8, /^\d{4}-Q[1-4]$/],
        ['yearly', 1, /^\d{4}$/],
    ])('%s returns fixed period buckets from the Redis source map', async (period, length, labelPattern) => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue(rows(todayIso(), todayIso()))

        const series = await getDashboardMessages({period})
        expect(series).toHaveLength(length)
        expect(series[0].label).toMatch(labelPattern)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2)
    })

    test('yearly returns all-time yearly buckets from the first message year', async () => {
        const currentYear = new Date().getUTCFullYear()
        mockFindFirst.mockResolvedValue({createdAt: new Date(Date.UTC(currentYear - 2, 5, 1))})
        mockFindMany
            .mockResolvedValueOnce(rows(
                `${currentYear - 2}-06-01T12:00:00Z`,
                `${currentYear - 1}-06-01T12:00:00Z`
            ))
            .mockResolvedValueOnce(rows(todayIso()))

        const series = await getDashboardMessages({period: 'yearly'})

        expect(series.map(bucket => bucket.label)).toEqual([
            String(currentYear - 2),
            String(currentYear - 1),
            String(currentYear),
        ])
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
    })

    test('source data is loaded once and then reused from Redis', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date('2024-01-01T00:00:00Z')})
        mockFindMany
            .mockResolvedValueOnce(rows('2024-01-01T00:00:00Z'))
            .mockResolvedValueOnce(rows(todayIso()))

        await getDashboardMessages({period: 'monthly'})
        expect(mockFindMany).toHaveBeenCalledTimes(2)
        expect(mockExpire).toHaveBeenCalledTimes(1)

        await getDashboardMessages({period: 'monthly'})
        expect(mockFindMany).toHaveBeenCalledTimes(2)
    })

    test('zero-count source maps are cache hits', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue([])

        await getDashboardMessages({period: 'yearly'})
        const firstCallCount = mockFindMany.mock.calls.length

        await getDashboardMessages({period: 'yearly'})
        expect(mockFindMany).toHaveBeenCalledTimes(firstCallCount)
    })

    test('historical source cache is extended when a new day completes', async () => {
        const todayStart = new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
        ))
        const yesterdayStart = new Date(todayStart)
        yesterdayStart.setUTCDate(todayStart.getUTCDate() - 1)
        const twoDaysAgoStart = new Date(todayStart)
        twoDaysAgoStart.setUTCDate(todayStart.getUTCDate() - 2)
        const yesterdayKey = yesterdayStart.toISOString().split('T')[0]

        mockStore.set('test:stats:count-source:messages:historical', {
            [twoDaysAgoStart.toISOString().split('T')[0]]: 3,
            __through: twoDaysAgoStart.toISOString().split('T')[0],
        })
        mockFindMany
            .mockResolvedValueOnce(rows(`${yesterdayKey}T12:00:00Z`, `${yesterdayKey}T13:00:00Z`))
            .mockResolvedValueOnce(rows(todayIso()))

        const series = await getDashboardMessages({period: 'daily'})
        const yesterdayLabel = yesterdayStart.toLocaleDateString('en-GB', {month: '2-digit', day: '2-digit'})
        const yesterdayBucket = series.find(bucket => bucket.label === yesterdayLabel)

        expect(yesterdayBucket.count).toBe(2)
        expect(mockStore.get('test:stats:count-source:messages:historical')).toMatchObject({
            [yesterdayKey]: 2,
            __through: yesterdayKey,
        })
    })

})
