// Deck-code statistics. Uses the real translator (cheap, no IO) and mocks only
// the card lookup, so the arithmetic under test is the real one.

jest.mock('../src/database/db', () => ({getCardsDB: jest.fn()}))
jest.mock('../src/tools/puppeteer', () => ({takeScreenshot: jest.fn()}))
jest.mock('../src/tools/fileManager', () => ({getDeckFiles: jest.fn(), deleteDeckFiles: jest.fn()}))

const {getCardsDB} = require('../src/database/db')
const {analyseDeck, readDeckCounts} = require('../src/tools/deck')

// The deck from the bug report: 4 cards at 1 copy, 8 at 2, 5 at 3, 1 at 4 — 39
// cards, of which 6 orders and 17 infantry.
const deckCode = '%%12|3NgUiaxr;3f3QpWsRv9vhw8z9;4poUwbxoza;z7'

const types = {
    // 1 copy each
    '3N': 'infantry', gU: 'infantry', ia: 'tank', xr: 'bomber',
    // 2 copies each
    '3f': 'order', '3Q': 'order', pW: 'order', sR: 'infantry',
    v9: 'tank', vh: 'bomber', w8: 'fighter', z9: 'fighter',
    // 3 copies each
    '4p': 'infantry', oU: 'infantry', wb: 'infantry', xo: 'tank', za: 'bomber',
    // 4 copies
    z7: 'infantry',
}

function card(importId, overrides = {}) {
    const type = types[importId]
    const isUnit = type !== 'order' && type !== 'countermeasure'

    return {
        importId,
        cardId: `${importId}-card`,
        type,
        attack: isUnit ? 2 : null,
        defense: isUnit ? 3 : null,
        operationCost: isUnit ? 1 : null,
        kredits: 2,
        ...overrides,
    }
}

const allCards = Object.keys(types).map(importId => card(importId))

function statsFrom(text) {
    const read = label => {
        const match = text.match(new RegExp(`${label}: ([0-9.]+)`))
        return match ? Number(match[1]) : null
    }

    return {
        orders: read('Orders'),
        units: read('Units'),
        infantry: read('Infantry'),
        tanks: read('Tanks'),
        kredits: read('Average kredit cost'),
    }
}

describe('readDeckCounts', () => {
    test('a card runs as many copies as its group is deep', () => {
        const counts = readDeckCounts('3NgUiaxr;3f3QpWsRv9vhw8z9;4poUwbxoza;z7')

        expect(counts.get('3N')).toBe(1)
        expect(counts.get('sR')).toBe(2)
        expect(counts.get('4p')).toBe(3)
        expect(counts.get('z7')).toBe(4)
        expect(counts.size).toBe(18)
    })

    // Read across the groups concatenated, a group of odd length shifts every
    // id after it by one character and the rest of the deck is misread.
    test('an odd-length group cannot shift the ids after it', () => {
        const counts = readDeckCounts('abX;cdef')

        expect(counts.get('ab')).toBe(1)
        expect(counts.get('cd')).toBe(2)
        expect(counts.get('ef')).toBe(2)
        expect(counts.has('Xc')).toBe(false)
    })

    // Two-character ids used to be matched with includes(), which finds them at
    // odd offsets inside a group and in groups they do not belong to.
    test('an id is only counted in its own group', () => {
        const counts = readDeckCounts('abcd;bcxy')

        expect(counts.get('bc')).toBe(2)
        expect(counts.get('ab')).toBe(1)
        expect(counts.get('cd')).toBe(1)
    })
})

describe('analyseDeck', () => {
    beforeEach(() => jest.clearAllMocks())

    test('counts the deck from the bug report correctly', async () => {
        getCardsDB.mockResolvedValueOnce(allCards)

        const stats = statsFrom(await analyseDeck(deckCode, 'en'))

        // 6 orders + 33 units = the 39 cards the code actually names
        expect(stats.orders).toBe(6)
        expect(stats.units).toBe(33)
        expect(stats.infantry).toBe(17)
        expect(stats.tanks).toBe(6)
    })

    // The reported bug: importId is not unique — only cardId is — so a card
    // reprinted under a second cardId came back twice and all four of its
    // copies were counted twice with it.
    test('counts a card once even when the database holds it twice', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {})
        getCardsDB.mockResolvedValueOnce([...allCards, card('z7', {cardId: 'z7-reprint'})])

        const stats = statsFrom(await analyseDeck(deckCode, 'en'))

        expect(stats.infantry).toBe(17)
        expect(stats.units).toBe(33)
        logged.mockRestore()
    })

    // Every copy costs its kredits: the average used to be taken over the
    // distinct cards, so a 4-copy card weighed the same as a 1-copy one.
    test('averages the kredit cost over copies, not over distinct cards', async () => {
        getCardsDB.mockResolvedValueOnce([
            card('3N', {kredits: 1}),          // 1 copy
            card('sR', {kredits: 9}),          // 2 copies
        ])

        const stats = statsFrom(await analyseDeck('%%12|3N;sR', 'en'))

        // (1x1 + 2x9) / 3 copies
        expect(stats.kredits).toBeCloseTo(6.33, 2)
    })

    test('reports the cards it could not find rather than silently dropping them', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {})
        getCardsDB.mockResolvedValueOnce([card('3N')])

        const stats = statsFrom(await analyseDeck('%%12|3NgU', 'en'))

        expect(stats.infantry).toBe(1)
        expect(logged.mock.calls[0].join(' ')).toContain('gU')
        logged.mockRestore()
    })

    test('returns false for a code with nothing after the separator', async () => {
        await expect(analyseDeck('%%12|', 'en')).resolves.toBe(false)
        expect(getCardsDB).not.toHaveBeenCalled()
    })
})
