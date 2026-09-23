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
