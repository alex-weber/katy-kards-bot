// An unnamed deck is titled with its nations' codes, main nation first.

jest.mock('../src/database/db', () => ({ getCardsDB: jest.fn() }))

const { nationCodes } = require('../src/tools/deckImage')

describe('nationCodes', () => {
    test('main nation first, then the ally', () => {
        expect(nationCodes({ main: 'usa', ally: 'italy' })).toBe('USA/ITA')
        expect(nationCodes({ main: 'soviet', ally: 'japan' })).toBe('SOV/JPN')
        expect(nationCodes({ main: 'germany', ally: 'britain' })).toBe('GER/BRIT')
    })

    test('a deck without an ally shows just the main nation', () => {
        expect(nationCodes({ main: 'finland', ally: undefined })).toBe('FIN')
    })

    test('no known nation gives an empty title, so the caller falls back', () => {
        expect(nationCodes({ main: undefined, ally: 'neutral' })).toBe('')
    })
})
