const mockJsonStore = new Map()
const mockGroupByCalls = []
const mockCountCalls = []
const mockFindManyCalls = []
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
            $disconnect: jest.fn(async () => {}),
        })),
    }
})

const {
    getTopMessages,
    getTopUsers,
    getDashboardMessages,
} = require('../src/database/message')

beforeEach(() => {
    mockJsonStore.clear()
    mockGroupByCalls.length = 0
    mockCountCalls.length = 0
    mockFindManyCalls.length = 0
    mockExpire.mockClear()
})

describe('period stats caching', () => {
    test('top-messages queries the selected yearly range once', async () => {
        const result = await getTopMessages({period: 'yearly'})
        const leo = result.find(r => r.command === 'leo')
        const is2 = result.find(r => r.command === 'is2')

        expect(leo.count).toBe(405)
        expect(is2.count).toBe(160)
        expect(leo.position).toBe(1)
        expect(mockGroupByCalls).toHaveLength(1)
    })

    test('top-users queries the selected yearly range and resolves usernames', async () => {
        const result = await getTopUsers({period: 'yearly'})
        const alice = result.find(u => u.authorId === 1)
        expect(alice.username).toBe('Alice')
        expect(alice.count).toBe(405)
    })

    test('period aggregate range is reused and current range gets a TTL', async () => {
        await getTopMessages({period: 'yearly'})
        expect(mockGroupByCalls).toHaveLength(1)
        expect(mockExpire).toHaveBeenCalledTimes(1)

        await getTopMessages({period: 'yearly'})
        expect(mockGroupByCalls).toHaveLength(1)

        for (const key of [...mockJsonStore.keys()]) {
            if (key.endsWith(':yearly:range')) mockJsonStore.delete(key)
        }

        await getTopMessages({period: 'yearly'})
        expect(mockGroupByCalls).toHaveLength(2)
    })

    test('dashboard time-series includes completed and current yearly buckets', async () => {
        const series = await getDashboardMessages({period: 'yearly'})
        expect(series).toHaveLength(5)
        expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(14)
    })
})
