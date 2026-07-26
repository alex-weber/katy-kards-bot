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
    test('daily returns a rolling 30-day window from the Redis source map', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue(rows(todayIso(), todayIso()))

        const series = await getDashboardMessages({period: 'daily'})
        expect(series).toHaveLength(30)
        expect(series[0].label).toMatch(/^\d{2}\/\d{2}$/)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2)
    })

    test('current-month returns a daily bucket per day of the month so far', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue(rows(todayIso(), todayIso()))

        const series = await getDashboardMessages({period: 'current-month'})
        expect(series).toHaveLength(new Date().getUTCDate())
        expect(series[0].label).toMatch(/^\d{2}\/\d{2}$/)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2)
    })

    test('all-time returns monthly buckets from the first data month (span <= 5y)', async () => {
        const currentYear = new Date().getUTCFullYear()
        const currentMonth = new Date().getUTCMonth()
        mockFindFirst.mockResolvedValue({createdAt: new Date(Date.UTC(currentYear - 2, 5, 1))})
        mockFindMany
            .mockResolvedValueOnce(rows(
                `${currentYear - 2}-06-01T12:00:00Z`,
                `${currentYear - 1}-06-01T12:00:00Z`
            ))
            .mockResolvedValueOnce(rows(todayIso()))

        const series = await getDashboardMessages({period: 'all-time'})
        const lastLabel = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`

        expect(series.every(bucket => /^\d{4}-\d{2}$/.test(bucket.label))).toBe(true)
        expect(series[0].label).toBe(`${currentYear - 2}-06`)
        expect(series[series.length - 1].label).toBe(lastLabel)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
    })

    test('source data is loaded once and then reused from Redis', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date('2024-01-01T00:00:00Z')})
        mockFindMany
            .mockResolvedValueOnce(rows('2024-01-01T00:00:00Z'))
            .mockResolvedValueOnce(rows(todayIso()))

        await getDashboardMessages({period: 'current-month'})
        expect(mockFindMany).toHaveBeenCalledTimes(2)
        expect(mockExpire).toHaveBeenCalledTimes(1)

        await getDashboardMessages({period: 'current-month'})
        expect(mockFindMany).toHaveBeenCalledTimes(2)
    })

    test('zero-count source maps are cache hits', async () => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue([])

        await getDashboardMessages({period: 'current-month'})
        const firstCallCount = mockFindMany.mock.calls.length

        await getDashboardMessages({period: 'current-month'})
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
