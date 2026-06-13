// Temporary unit test for the historical+today stats caching merge logic.
// Mocks Redis and Prisma so no live services are required.

const mockJsonStore = new Map()
const mockGroupByCalls = []
const mockFindManyCalls = []

jest.mock('../src/controller/redis', () => ({
    cachePrefix: 'test:',
    redis: {
        json: {
            get: jest.fn(async (key) => (mockJsonStore.has(key) ? mockJsonStore.get(key) : null)),
            set: jest.fn(async (key, _path, value) => { mockJsonStore.set(key, value) }),
        },
        expire: jest.fn(async () => {}),
    },
}))

jest.mock('@prisma/client', () => {
    return {
        PrismaClient: jest.fn().mockImplementation(() => ({
            message: {
                groupBy: jest.fn(async (args) => {
                    mockGroupByCalls.push(args)
                    const gte = args.where.createdAt.gte
                    const lte = args.where.createdAt.lte
                    const isToday = gte.toISOString().slice(0, 10) === lte.toISOString().slice(0, 10)
                    if (args.by[0] === 'content') {
                        return isToday
                            ? [{ content: 'leo', _count: { content: 5 } }]
                            : [
                                { content: 'leo', _count: { content: 100 } },
                                { content: 'is2', _count: { content: 40 } },
                              ]
                    }
                    return isToday
                        ? [{ authorId: 1, _count: { content: 5 } }]
                        : [
                            { authorId: 1, _count: { content: 100 } },
                            { authorId: 2, _count: { content: 40 } },
                          ]
                }),
                findMany: jest.fn(async (args) => {
                    mockFindManyCalls.push(args)
                    const gte = new Date(args.where.createdAt.gte)
                    const lte = new Date(args.where.createdAt.lte)
                    const isToday = gte.toISOString().slice(0, 10) === lte.toISOString().slice(0, 10)
                    if (isToday) {
                        return [{ createdAt: gte }, { createdAt: gte }] // 2 today
                    }
                    const d1 = new Date(gte.getTime())
                    const d2 = new Date(gte.getTime() + 24 * 60 * 60 * 1000)
                    return [{ createdAt: d1 }, { createdAt: d1 }, { createdAt: d2 }] // 3 historical
                }),
                count: jest.fn(async () => 0),
            },
            user: {
                findMany: jest.fn(async () => [
                    { id: 1, name: 'Alice', discordId: '111' },
                    { id: 2, name: 'Bob', discordId: '222' },
                ]),
            },
            $disconnect: jest.fn(async () => {}),
        })),
    }
})

const {
    getTopMessages,
    getTopUsers,
    getDashboardMessages,
    daysAgoString,
} = require('../src/database/message')

beforeEach(() => {
    mockJsonStore.clear()
    mockGroupByCalls.length = 0
    mockFindManyCalls.length = 0
})

describe('stats caching merge', () => {
    const from = '2020-01-01'
    const to = daysAgoString(0) // today => triggers historical + today split

    test('top-messages merges historical and today counts', async () => {
        const result = await getTopMessages({ from, to })
        const leo = result.find(r => r.command === 'leo')
        const is2 = result.find(r => r.command === 'is2')
        expect(leo.count).toBe(105) // 100 historical + 5 today
        expect(is2.count).toBe(40)
        expect(leo.position).toBe(1)
        expect(mockGroupByCalls.length).toBe(2) // historical + today slices
    })

    test('top-users merges and resolves usernames', async () => {
        const result = await getTopUsers({ from, to })
        const alice = result.find(u => u.authorId === 1)
        expect(alice.username).toBe('Alice')
        expect(alice.count).toBe(105)
    })

    test('historical slice is reused; only today is recomputed after its TTL', async () => {
        await getTopMessages({ from, to })
        expect(mockGroupByCalls.length).toBe(2) // historical + today

        // Fully cached within the window: no new queries.
        await getTopMessages({ from, to })
        expect(mockGroupByCalls.length).toBe(2)

        // Simulate the short today-cache expiring (historical stays cached).
        for (const key of [...mockJsonStore.keys()]) {
            if (key.includes(':today:')) mockJsonStore.delete(key)
        }
        await getTopMessages({ from, to })
        expect(mockGroupByCalls.length).toBe(3) // only today re-queried, not historical
    })

    test('dashboard time-series includes today bucket count', async () => {
        const series = await getDashboardMessages({ from, to })
        const total = series.reduce((s, b) => s + b.count, 0)
        expect(total).toBe(5) // 3 historical + 2 today
    })
})
