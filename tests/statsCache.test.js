const mockJsonStore = new Map()
const mockGroupByCalls = []
const mockCountCalls = []
const mockFindManyCalls = []
const mockQueryRawCalls = []
const mockExpire = jest.fn(async () => {})

jest.mock('../src/controller/redis', () => ({
    cachePrefix: 'test:',
    redis: {
        json: {
            get: jest.fn(async key => (mockJsonStore.has(key) ? mockJsonStore.get(key) : null)),
            set: jest.fn(async (key, _path, value) => { mockJsonStore.set(key, value) }),
        },
        expire: mockExpire,
    },
}))

jest.mock('@prisma/client', () => {
    return {
        PrismaClient: jest.fn().mockImplementation(() => ({
            message: {
                groupBy: jest.fn(async args => {
                    mockGroupByCalls.push(args)
                    const isAllTime = !args.where?.createdAt
                    if (isAllTime && args.by[0] === 'content') {
                        return [
                            {content: 'leo', _count: {content: 505}},
                            {content: 'is2', _count: {content: 200}},
                        ]
                    }
                    if (isAllTime) {
                        return [
                            {authorId: 1, _count: {content: 505}},
                            {authorId: 2, _count: {content: 200}},
                        ]
                    }

                    const isCurrentYear =
                        args.where.createdAt.gte.getUTCFullYear() === new Date().getUTCFullYear()
                    const isYearlyRange =
                        args.where.createdAt.lte.getUTCFullYear() === new Date().getUTCFullYear()

                    if (args.by[0] === 'content') {
                        return isCurrentYear
                            ? [{content: 'leo', _count: {content: 5}}]
                            : isYearlyRange
                                ? [
                                    {content: 'leo', _count: {content: 405}},
                                    {content: 'is2', _count: {content: 160}},
                                  ]
                            : [
                                {content: 'leo', _count: {content: 100}},
                                {content: 'is2', _count: {content: 40}},
                              ]
                    }

                    return isCurrentYear
                        ? [{authorId: 1, _count: {content: 5}}]
                        : isYearlyRange
                            ? [
                                {authorId: 1, _count: {content: 405}},
                                {authorId: 2, _count: {content: 160}},
                              ]
                        : [
                            {authorId: 1, _count: {content: 100}},
                            {authorId: 2, _count: {content: 40}},
                          ]
                }),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date(Date.UTC(new Date().getUTCFullYear() - 4, 0, 1)),
                })),
                findMany: jest.fn(async args => {
                    mockFindManyCalls.push(args)
                    const year = new Date().getUTCFullYear()
                    const rows = []
                    for (let y = year - 4; y < year; y++) {
                        rows.push(
                            {createdAt: new Date(Date.UTC(y, 0, 1))},
                            {createdAt: new Date(Date.UTC(y, 1, 1))},
                            {createdAt: new Date(Date.UTC(y, 2, 1))},
                        )
                    }
                    return args.where.createdAt.gte.getUTCFullYear() === year
                        ? [
                            {createdAt: new Date()},
                            {createdAt: new Date()},
                          ]
                        : rows
                }),
                count: jest.fn(async args => {
                    mockCountCalls.push(args)
                    return args.where.createdAt.gte.getUTCFullYear() === new Date().getUTCFullYear() ? 2 : 3
                }),
            },
            user: {
                findMany: jest.fn(async () => [
                    {id: 1, name: 'Alice', discordId: '111'},
                    {id: 2, name: 'Bob', discordId: '222'},
                ]),
            },
            $queryRaw: jest.fn(async (...args) => {
                mockQueryRawCalls.push(args)
                const query = Array.isArray(args[0]) ? args[0].join('') : String(args[0])
                if (query.includes('"authorId"')) {
                    return [
                        {authorId: 1, position: 1},
                        {authorId: 2, position: 2},
                    ]
                }
                return [
                    {content: 'leo', position: 1},
                    {content: 'is2', position: 2},
                ]
            }),
            $disconnect: jest.fn(async () => {}),
        })),
        Prisma: {
            join: values => values,
        },
    }
})

const {
    getTopMessages,
    getTopUsers,
    getDashboardMessages,
    buildStatsBuckets,
} = require('../src/database/message')

beforeEach(() => {
    mockJsonStore.clear()
    mockGroupByCalls.length = 0
    mockCountCalls.length = 0
    mockFindManyCalls.length = 0
    mockQueryRawCalls.length = 0
    mockExpire.mockClear()
})

describe('period stats caching', () => {
    test('top-messages queries the selected all-time range once', async () => {
        const result = await getTopMessages({period: 'all-time'})
        const leo = result.find(r => r.command === 'leo')
        const is2 = result.find(r => r.command === 'is2')

        expect(leo.count).toBe(405)
        expect(is2.count).toBe(160)
        expect(leo.position).toBe(1)
        expect(leo.allTimePosition).toBe(1)
        expect(is2.allTimePosition).toBe(2)
        expect(mockGroupByCalls).toHaveLength(1)
        expect(mockQueryRawCalls).toHaveLength(1)
    })

    test('top-users queries the selected all-time range and resolves usernames', async () => {
        const result = await getTopUsers({period: 'all-time'})
        const alice = result.find(u => u.authorId === 1)
        expect(alice.username).toBe('Alice')
        expect(alice.count).toBe(405)
        expect(alice.allTimePosition).toBe(1)
    })

    test('current-month aggregates only the current-year range', async () => {
        const result = await getTopMessages({period: 'current-month'})
        const leo = result.find(r => r.command === 'leo')
        expect(leo.count).toBe(5)
    })

    test('aggregate range is reused and the current range gets a TTL', async () => {
        await getTopMessages({period: 'all-time'})
        expect(mockGroupByCalls).toHaveLength(1)
        expect(mockExpire).toHaveBeenCalledTimes(2)

        await getTopMessages({period: 'all-time'})
        expect(mockGroupByCalls).toHaveLength(1)
        expect(mockQueryRawCalls).toHaveLength(1)

        for (const key of [...mockJsonStore.keys()]) {
            if (key.endsWith(':all-time:range')) mockJsonStore.delete(key)
        }

        await getTopMessages({period: 'all-time'})
        expect(mockGroupByCalls).toHaveLength(2)
        expect(mockQueryRawCalls).toHaveLength(1)
    })

    test('last-year time-series is 12 monthly buckets summing that year', async () => {
        const series = await getDashboardMessages({period: 'last-year'})
        const lastYear = new Date().getUTCFullYear() - 1

        expect(series).toHaveLength(12)
        expect(series.every(bucket => /^\d{4}-\d{2}$/.test(bucket.label))).toBe(true)
        expect(series[0].label).toBe(`${lastYear}-01`)
        // Only Jan/Feb/Mar of last year carry data in the fixture (one each).
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
    })
})

describe('buildStatsBuckets granularity', () => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()

    test('current-month is daily from the 1st to today', () => {
        const buckets = buildStatsBuckets('current-month')
        expect(buckets.every(b => b.granularity === 'daily')).toBe(true)
        expect(buckets).toHaveLength(now.getUTCDate())
        expect(buckets[0].fromDate.getTime()).toBe(Date.UTC(year, month, 1))
        expect(buckets[buckets.length - 1].fromDate.getTime())
            .toBe(Date.UTC(year, month, now.getUTCDate()))
    })

    test('last-month is daily and covers the whole previous month', () => {
        const buckets = buildStatsBuckets('last-month')
        const daysInLastMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
        expect(buckets.every(b => b.granularity === 'daily')).toBe(true)
        expect(buckets.every(b => b.completed)).toBe(true)
        expect(buckets).toHaveLength(daysInLastMonth)
        expect(buckets[0].fromDate.getTime()).toBe(Date.UTC(year, month - 1, 1))
    })

    test('current-year is monthly from January through the current month', () => {
        const buckets = buildStatsBuckets('current-year')
        expect(buckets.every(b => b.granularity === 'monthly')).toBe(true)
        expect(buckets).toHaveLength(month + 1)
        expect(buckets[0].key).toBe(`${year}-01`)
        expect(buckets[buckets.length - 1].key)
            .toBe(`${year}-${String(month + 1).padStart(2, '0')}`)
        // the current month is still in progress, so its bucket is not completed
        expect(buckets[buckets.length - 1].completed).toBe(false)
    })

    test('last-year is 12 completed monthly buckets of the previous year', () => {
        const buckets = buildStatsBuckets('last-year')
        expect(buckets).toHaveLength(12)
        expect(buckets.every(b => b.granularity === 'monthly')).toBe(true)
        expect(buckets.every(b => b.completed)).toBe(true)
        expect(buckets[0].key).toBe(`${year - 1}-01`)
        expect(buckets[11].key).toBe(`${year - 1}-12`)
    })

    test('all-time uses months when data spans five years or less', () => {
        const buckets = buildStatsBuckets('all-time', new Date(Date.UTC(year - 3, 0, 1)))
        expect(buckets.every(b => b.granularity === 'monthly')).toBe(true)
        expect(buckets[0].key).toBe(`${year - 3}-01`)
    })

    test('all-time uses quarters when data spans more than five years', () => {
        const buckets = buildStatsBuckets('all-time', new Date(Date.UTC(year - 7, 0, 1)))
        expect(buckets.every(b => b.granularity === 'quarterly')).toBe(true)
        expect(buckets.every(b => /^\d{4}-Q[1-4]$/.test(b.key))).toBe(true)
        expect(buckets[0].key).toBe(`${year - 7}-Q1`)
    })
})
