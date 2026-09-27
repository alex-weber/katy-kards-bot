// advancedSearch() must try the raw query as a literal full-text match before
// parsing it into attributes. getVariables() rewrites recognized words (e.g.
// "air" -> a plane type filter) and drops them as free text, which would
// otherwise make a literal title like "Air Cover" unfindable if the card
// itself isn't a plane.

jest.mock('../src/database/db', () => ({
    getCardsDB: jest.fn(async () => []),
    getSynonym: jest.fn(),
    createSynonym: jest.fn(),
    updateSynonym: jest.fn(),
    deleteSynonym: jest.fn(),
    getAllSynonyms: jest.fn(),
    FULL_TEXT_LOCALES: ['en-EN', 'ru-RU', 'ja-JP', 'ko-KR', 'zh-Hant', 'zh-Hans'],
}))
jest.mock('../src/tools/imageUpload', () => ({ uploadImageFromUrl: jest.fn() }))
jest.mock('../src/controller/synonymCache', () => ({ invalidateSynonymCache: jest.fn() }))

const { advancedSearch } = require('../src/tools/search')
const { getCardsDB } = require('../src/database/db')

function baseVariables(q) {
    return { q, showSpawnables: true, showReserved: true, first: 60, offset: 0 }
}

beforeEach(() => {
    jest.clearAllMocks()
})

test('finds a card by literal title before "air" is parsed into a plane-type filter', async () => {
    const airCoverCard = { title: 'Air Cover', imageURL: '/air-cover.avif' }
    getCardsDB.mockImplementation(async (where) => {
        // the literal attempt ANDs fullText contains 'air' and 'cover'
        if (where.AND && where.AND.length === 2) return [airCoverCard]
        return []
    })

    const result = await advancedSearch(baseVariables('air cover'))

    expect(result.counter).toBe(1)
    expect(result.cards[0]).toBe(airCoverCard)
    // only the literal query should have been needed
    expect(getCardsDB).toHaveBeenCalledTimes(1)
})

test('falls back to attribute parsing when the literal match finds nothing', async () => {
    getCardsDB.mockResolvedValueOnce([]) // literal attempt: no match
        .mockResolvedValueOnce([{ title: 'Some Bomber', imageURL: '/b.avif' }]) // parsed attempt

    const result = await advancedSearch(baseVariables('air'))

    expect(result.counter).toBe(1)
    expect(getCardsDB).toHaveBeenCalledTimes(2)
    // the parsed attempt should have filtered by plane type, not literal text
    const parsedWhere = getCardsDB.mock.calls[1][0]
    expect(parsedWhere.type).toEqual({ in: ['bomber', 'fighter'] })
})

test('an empty query skips the literal attempt entirely', async () => {
    getCardsDB.mockResolvedValue([])

    await advancedSearch(baseVariables(''))

    expect(getCardsDB).toHaveBeenCalledTimes(1)
})

describe('explicit "field:value" filters (written by /find)', () => {
    test('skip the literal pass and match the columns exactly', async () => {
        getCardsDB.mockResolvedValue([{ title: 'Routed Troops', imageURL: '/r.avif' }])

        await advancedSearch(baseVariables('faction:neutral type:infantry'))

        // one query only: card text saying "neutral" must not be matched
        expect(getCardsDB).toHaveBeenCalledTimes(1)
        const where = getCardsDB.mock.calls[0][0]
        expect(where.faction).toBe('neutral')
        expect(where.type).toBe('infantry')
        expect(where.AND).toBeUndefined()
    })

    test('combine with costs and free text', async () => {
        await advancedSearch(baseVariables('faction:soviet 3k guard'))

        const where = getCardsDB.mock.calls[0][0]
        expect(where).toMatchObject({ faction: 'soviet', kredits: 3 })
        expect(where.AND).toEqual([{ fullText: { contains: 'guard', mode: 'insensitive' } }])
    })

    test('"term:" keeps the rest of the query as plain text', async () => {
        await advancedSearch(baseVariables('faction:britain type:infantry term:neutral 2k'))

        expect(getCardsDB).toHaveBeenCalledTimes(1)
        const where = getCardsDB.mock.calls[0][0]
        // "neutral" must not replace the faction, "2k" is not a kredits filter
        expect(where).toMatchObject({ faction: 'britain', type: 'infantry' })
        expect(where.kredits).toBeUndefined()
        expect(where.AND).toEqual([
            { fullText: { contains: 'neutral', mode: 'insensitive' } },
            { fullText: { contains: '2k', mode: 'insensitive' } },
        ])
    })

    test('"term:" alone skips the literal pass too', async () => {
        await advancedSearch(baseVariables('term:air cover'))

        expect(getCardsDB).toHaveBeenCalledTimes(1)
        expect(getCardsDB.mock.calls[0][0].type).toBeUndefined()
    })

    test('an unknown value is searched as plain text, not as a filter', async () => {
        await advancedSearch(baseVariables('faction:mars'))

        // not a valid filter -> the literal pass runs as for any other word
        expect(getCardsDB.mock.calls[0][0].faction).toBeUndefined()
    })
})
