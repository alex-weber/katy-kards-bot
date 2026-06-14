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
})
