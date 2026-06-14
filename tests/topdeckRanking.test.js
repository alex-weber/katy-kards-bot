jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn(() => ({
        user: { findMany: jest.fn() },
        topdeck: {},
        card: {},
        $disconnect: jest.fn(),
    })),
}))

const {buildTopDeckRanking} = require('../src/database/topdeck')

describe('buildTopDeckRanking', () => {
    test('uses the same score formula as !ranking and returns the top limit', () => {
        const ranking = buildTopDeckRanking([
            { id: 1, discordId: '1', name: 'Low', tdGames: 3, tdWins: 1, tdLoses: 2, tdDraws: 0 },
            { id: 2, discordId: '2', name: 'High', tdGames: 5, tdWins: 3, tdLoses: 1, tdDraws: 2 },
            { id: 3, discordId: '3', name: 'Mid', tdGames: 4, tdWins: 2, tdLoses: 1, tdDraws: 1 },
        ], 2)

        expect(ranking).toEqual([
            expect.objectContaining({ name: 'High', score: 6, winRatio: '0.60' }),
            expect.objectContaining({ name: 'Mid', score: 3, winRatio: '0.50' }),
        ])
    })
})
