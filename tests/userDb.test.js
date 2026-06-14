const mockFindMany = jest.fn(async () => [])
const mockDisconnect = jest.fn(async () => {})

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn(() => ({
        user: {
            findMany: mockFindMany,
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        $disconnect: mockDisconnect,
    })),
}))

const {getUsers} = require('../src/database/user')

describe('getUsers', () => {
    beforeEach(() => {
        mockFindMany.mockClear()
        mockDisconnect.mockClear()
    })

    test('inactive status filter matches any non-active status', async () => {
        await getUsers({status: 'inactive'})

        expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                status: {
                    not: 'active',
                },
            },
        }))
    })

    test('sorts by role hierarchy, then total command count descending', async () => {
        mockFindMany.mockResolvedValueOnce([
            {id: 1, role: null, _count: {messages: 100}},
            {id: 2, role: 'VIP', _count: {messages: 5}},
            {id: 3, role: 'GOD', _count: {messages: 10}},
            {id: 4, role: 'VIP', _count: {messages: 20}},
            {id: 5, role: 'GOD', _count: {messages: 50}},
            {id: 6, role: 'PRISONER', _count: {messages: 500}},
        ])

        const result = await getUsers()

        expect(result.users.map(user => user.id)).toEqual([5, 3, 4, 2, 1, 6])
    })
})
