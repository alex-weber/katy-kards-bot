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
        ['yearly', 5, /^\d{4}$/],
    ])('%s returns fixed period buckets from the Redis source map', async (period, length, labelPattern) => {
        mockFindFirst.mockResolvedValue({createdAt: new Date()})
        mockFindMany.mockResolvedValue(rows(todayIso(), todayIso()))

        const series = await getDashboardMessages({period})
        expect(series).toHaveLength(length)
        expect(series[0].label).toMatch(labelPattern)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2)
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

})
