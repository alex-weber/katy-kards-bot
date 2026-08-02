// Tests for the per-user / paginated message DB helpers in message.js,
// with Prisma and Redis mocked.

const mockStore = new Map()
const mockCount = jest.fn()
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockGroupBy = jest.fn()
const mockUserFindMany = jest.fn()
const mockCreate = jest.fn()
const mockQueryRaw = jest.fn()

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
        message: { count: mockCount, findMany: mockFindMany, findFirst: mockFindFirst, groupBy: mockGroupBy, create: mockCreate },
        user: { findMany: mockUserFindMany },
        $queryRaw: mockQueryRaw,
        $disconnect: jest.fn(),
    })),
    Prisma: {
        join: values => values,
    },
}))

const {
    createMessage,
    getProfileStats,
    getUserMessages,
    getMessages,
    getScreenshotMessages,
    getTopUsers,
} = require('../src/database/message')

beforeEach(() => {
    mockStore.clear()
    mockCount.mockReset()
    mockFindMany.mockReset()
    mockFindFirst.mockReset()
    mockGroupBy.mockReset()
    mockUserFindMany.mockReset()
    mockCreate.mockReset()
    mockQueryRaw.mockReset()
})

describe('createMessage', () => {
    test('delegates to prisma.message.create', async () => {
        mockCreate.mockResolvedValueOnce({ id: 1, content: 'leo' })
        const created = await createMessage({ authorId: 7, content: 'leo' })
        expect(mockCreate).toHaveBeenCalledWith({ data: { authorId: 7, content: 'leo' } })
        expect(created.id).toBe(1)
    })
})

describe('getScreenshotMessages', () => {
    test('builds period buckets and filters by the screenshot marker', async () => {
        mockFindMany.mockResolvedValue([{ createdAt: new Date() }])
        mockCount.mockResolvedValue(1)
        const series = await getScreenshotMessages({period: 'daily'})
        expect(series).toHaveLength(30)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1)
        // both screenshot markers are applied to the query: the deck code and
        // the deck link, since either one triggers a Browserless capture
        const where = mockFindMany.mock.calls[0][0].where
        expect(where.OR).toHaveLength(2)
        expect(where.OR[0].content.contains).toBe('%\\%\\%%')
        expect(where.OR[1].AND.map(clause => clause.content.contains)).toEqual([
            'https://www.kards.com/',
            '/decks/',
        ])
    })
})

describe('getProfileStats', () => {
    // Cache key for the current-month leaderboard, whose key carries the month.
    const currentMonthPositionsKey = (() => {
        const now = new Date()
        const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
        return `test:stats:current-month:user-message-positions:${monthKey}`
    })()

    test('returns the counts and both leaderboard positions and caches them', async () => {
        mockCount
            .mockResolvedValueOnce(100) // total
            .mockResolvedValueOnce(20)  // current month
            .mockResolvedValueOnce(5)   // last day
        mockQueryRaw
            .mockResolvedValueOnce([{ authorId: 7, position: 2 }]) // all-time
            .mockResolvedValueOnce([{ authorId: 7, position: 3 }]) // current month
        const stats = await getProfileStats(7)
        expect(stats).toEqual({ total: 100, currentMonth: 20, lastDay: 5, allTimePosition: 2, currentMonthPosition: 3 })

        // Second call served from cache → no further DB counts
        mockCount.mockClear()
        const again = await getProfileStats(7)
        expect(again).toEqual({ total: 100, currentMonth: 20, lastDay: 5, allTimePosition: 2, currentMonthPosition: 3 })
        expect(mockCount).not.toHaveBeenCalled()
    })

    test('uses cached RedisJSON position maps with root path wrappers', async () => {
        mockStore.set('test:stats:all-time:user-message-positions', [{ '7': 1 }])
        mockStore.set(currentMonthPositionsKey, [{ '7': 4 }])
        mockCount
            .mockResolvedValueOnce(100) // total
            .mockResolvedValueOnce(20)  // current month
            .mockResolvedValueOnce(5)   // last day

        const stats = await getProfileStats(7)

        expect(stats.allTimePosition).toBe(1)
        expect(stats.currentMonthPosition).toBe(4)
        expect(mockQueryRaw).not.toHaveBeenCalled()
    })

    test('recomputes cached profile stats that predate the month stats', async () => {
        mockStore.set('test:profile:stats:7', { total: 100, lastDay: 5, allTimePosition: 1 })
        mockCount
            .mockResolvedValueOnce(100) // total
            .mockResolvedValueOnce(20)  // current month
            .mockResolvedValueOnce(5)   // last day
        mockQueryRaw
            .mockResolvedValueOnce([{ authorId: 7, position: 1 }]) // all-time
            .mockResolvedValueOnce([{ authorId: 7, position: 6 }]) // current month

        const stats = await getProfileStats(7)

        expect(stats).toEqual({ total: 100, currentMonth: 20, lastDay: 5, allTimePosition: 1, currentMonthPosition: 6 })
        expect(mockCount).toHaveBeenCalled()
        expect(mockStore.get('test:profile:stats:7').currentMonthPosition).toBe(6)
    })
})

describe('getUserMessages', () => {
    test('returns last-day messages plus the total count', async () => {
        mockFindMany.mockResolvedValueOnce([
            { id: 1, content: 'leo', createdAt: new Date('2024-06-01T10:00:00Z') },
        ])
        mockCount.mockResolvedValueOnce(42) // total
        const result = await getUserMessages(7)
        expect(result.totalCount).toBe(42)
        expect(result.lastMonthMessagesCount).toBeUndefined()
        expect(result.lastDayMessages).toHaveLength(1)
        expect(typeof result.lastDayMessages[0].createdAt).toBe('string') // formatted
    })
})

describe('getMessages (paginated log)', () => {
    test('runs count + findMany and shapes the result on a cache miss', async () => {
        mockCount.mockResolvedValueOnce(3)
        mockFindMany.mockResolvedValueOnce([
            { id: 1, content: 'a', createdAt: new Date('2024-06-01T10:00:00Z'), author: { name: 'Al' } },
        ])
        const res = await getMessages({ from: '2024-06-01', to: '2024-06-02', page: 1, pageSize: 50 })
        expect(res.totalCount).toBe(3)
        expect(res.messages).toHaveLength(1)
        expect(res.page).toBe(1)
    })

    test('serves from cache on the second identical call', async () => {
        mockCount.mockResolvedValue(0)
        mockFindMany.mockResolvedValue([])
        await getMessages({ from: '2024-06-01', to: '2024-06-02', page: 2, pageSize: 10, username: 'x', command: 'y' })
        mockFindMany.mockClear()
        await getMessages({ from: '2024-06-01', to: '2024-06-02', page: 2, pageSize: 10, username: 'x', command: 'y' })
        expect(mockFindMany).not.toHaveBeenCalled()
    })
})

describe('getTopUsers', () => {
    test('resolves usernames and filters out the bot account', async () => {
        const to = new Date().toISOString().split('T')[0]
        // historical + today slices both queried
        mockGroupBy.mockResolvedValue([
            { authorId: 1, _count: { content: 50 } },
            { authorId: 2, _count: { content: 10 } },
        ])
        mockUserFindMany.mockResolvedValue([
            { id: 1, name: 'Alice', discordId: '111' },
            { id: 2, name: 'Катюха', discordId: '222' },
        ])
        mockQueryRaw.mockResolvedValueOnce([
            { authorId: 1, position: 1 },
            { authorId: 2, position: 2 },
        ])
        const result = await getTopUsers({ from: '2020-01-01', to })
        const names = result.map(u => u.username)
        expect(names).toContain('Alice')
        expect(names).not.toContain('Катюха') // bot filtered out
    })
})
