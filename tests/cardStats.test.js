// Tests for the per-faction card stats aggregation (src/database/card.js).

jest.mock('../src/database/prisma', () => ({
    prisma: { card: { findMany: jest.fn(), groupBy: jest.fn() } },
}))

const { prisma } = require('../src/database/prisma')
const { getCardsByFaction, getFactionCardStats } = require('../src/database/card')

beforeEach(() => jest.clearAllMocks())

describe('getCardsByFaction', () => {
    test('merges reserve groups into per-faction totals, largest first', async () => {
        prisma.card.groupBy.mockResolvedValue([
            { faction: 'usa', reserved: false, _count: { _all: 182 } },
            { faction: 'japan', reserved: false, _count: { _all: 300 } },
            { faction: 'usa', reserved: true, _count: { _all: 102 } },
            { faction: 'usa', reserved: null, _count: { _all: 1 } },
        ])

        await expect(getCardsByFaction()).resolves.toEqual([
            { faction: 'japan', count: 300, active: 300, reserved: 0 },
            { faction: 'usa', count: 285, active: 183, reserved: 102 },
        ])
    })
})

describe('getFactionCardStats', () => {
    test('counts rarity, type and dictionary attributes for all / active / reserved', async () => {
        prisma.card.findMany.mockResolvedValue([
            { rarity: 'elite', type: 'tank', attributes: 'blitz,heavyarmor1', reserved: false },
            { rarity: 'standard', type: 'infantry', attributes: 'blitz, fury', reserved: true },
            { rarity: 'standard', type: 'order', attributes: '', reserved: false },
            { rarity: 'limited', type: 'infantry', attributes: null, reserved: null },
            { rarity: 'elite', type: 'tank', attributes: 'heavyarmor2,intel3,onlyspawnable', reserved: true },
            { rarity: 'special', type: 'infantry', attributes: 'veteranof:the_regulars_vet', reserved: false },
            { rarity: 'special', type: 'infantry', attributes: 'becomesveteran:the_regulars_vet', reserved: false },
        ])

        const stats = await getFactionCardStats('usa')

        expect(prisma.card.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { faction: 'usa' } }))
        expect(stats.all.total).toBe(7)
        expect(stats.active.total).toBe(5) // reserved: null counts as active
        expect(stats.reserved.total).toBe(2)

        expect(stats.all.rarity).toEqual({ standard: 2, limited: 1, special: 2, elite: 2 })
        expect(stats.reserved.rarity.standard).toBe(1)
        expect(stats.all.type.infantry).toBe(4)
        expect(stats.active.type.tank).toBe(1)

        expect(stats.all.attribute.blitz).toBe(2)
        expect(stats.all.attribute.fury).toBe(1)
        expect(stats.active.attribute.fury).toBe(0)
        // Every level of a keyword counts as that keyword.
        expect(stats.all.attribute['heavy armor']).toBe(2)
        expect(stats.active.attribute['heavy armor']).toBe(1)
        expect(stats.reserved.attribute['heavy armor']).toBe(1)
        expect(stats.all.attribute.intel).toBe(1)
        // "veteranof:<card>" is a veteran; "becomesveteran:<card>" is not.
        expect(stats.all.attribute.veteran).toBe(1)
        // Only dictionary keywords are counted.
        expect(stats.all.attribute).not.toHaveProperty('heavyarmor1')
        expect(stats.all.attribute).not.toHaveProperty('onlyspawnable')
        expect(stats.all.attribute).not.toHaveProperty('becomesveteran:the_regulars_vet')
    })

    test('counts a keyword once even when a card carries two of its levels', async () => {
        prisma.card.findMany.mockResolvedValue([
            { rarity: 'elite', type: 'tank', attributes: 'heavyarmor1,heavyarmor2', reserved: false },
        ])

        const stats = await getFactionCardStats('germany')

        expect(stats.all.attribute['heavy armor']).toBe(1)
    })

    test('returns zeroed buckets for a faction without cards', async () => {
        prisma.card.findMany.mockResolvedValue([])

        const stats = await getFactionCardStats('anzac')

        expect(stats.all.total).toBe(0)
        expect(stats.reserved.rarity.elite).toBe(0)
        expect(stats.active.attribute.blitz).toBe(0)
    })
})
