// Unit tests for the search routing gate: queries written in a language the
// sync mirrors into Card.fullText are answered from the local DB, everything
// else still goes to kards.com. Both the DB and the network are mocked, so no
// card is ever fetched and no connection is opened.

jest.mock('../src/database/db', () => ({
    getCardsDB: jest.fn(async () => []),
    getSynonym: jest.fn(),
    createSynonym: jest.fn(),
    updateSynonym: jest.fn(),
    deleteSynonym: jest.fn(),
    getAllSynonyms: jest.fn(),
    // the real list, so the gate is tested against what the sync actually stores
    FULL_TEXT_LOCALES: ['en-EN', 'ru-RU', 'ja-JP', 'ko-KR', 'zh-Hant', 'zh-Hans'],
}))
jest.mock('../src/tools/fetch', () => ({ fetchJson: jest.fn() }))
jest.mock('../src/tools/imageUpload', () => ({ uploadImageFromUrl: jest.fn() }))
jest.mock('../src/controller/synonymCache', () => ({ invalidateSynonymCache: jest.fn() }))

const { getCards, isFullTextLanguage } = require('../src/tools/search')
const { getCardsDB } = require('../src/database/db')
const { fetchJson } = require('../src/tools/fetch')

// The shape getCards() gets back from the KARDS GraphQL API.
function apiResponse(count) {
    return {
        data: {
            data: {
                cards: {
                    pageInfo: { count, hasNextPage: false },
                    edges: Array.from({ length: count }, (_, i) => ({
                        node: { imageUrl: `/images/card/${i}.avif`, reserved: false },
                    })),
                },
            },
        },
    }
}

function searchVariables(language, q) {
    return { language, q, showSpawnables: true, showReserved: true, first: 60, offset: 0 }
}

beforeEach(() => {
    jest.clearAllMocks()
    getCardsDB.mockResolvedValue([])
})

describe('isFullTextLanguage', () => {
    // Discord passes the API locale, Telegram the short code - kards.com treats
    // them as the same language, and so must the gate.
    test.each([
        ['en-EN', true], ['en', true],
        ['ru-RU', true], ['ru', true],
        ['ja-JP', true], ['jp', true],
        ['ko-KR', true], ['ko', true],
        ['zh-Hant', true], ['tw', true],
        ['zh-Hans', true], ['zh', true],
    ])('%s is answered from the DB', (language, expected) => {
        expect(isFullTextLanguage(language)).toBe(expected)
    })

    // These locales are not written into fullText, so only kards.com has them.
    test.each([
        ['de-DE', false], ['de', false],
        ['es-ES', false], ['es', false],
        ['fr-FR', false], ['fr', false],
        ['it-IT', false], ['it', false],
        ['pl-PL', false], ['pl', false],
        ['pt-BR', false], ['pt', false],
    ])('%s still needs the API', (language, expected) => {
        expect(isFullTextLanguage(language)).toBe(expected)
    })

    test.each([[undefined], [null], [''], [42], [{}]])
    ('%p is not a full text language', (language) => {
        expect(isFullTextLanguage(language)).toBe(false)
    })
})

describe('getCards routing', () => {
    test('a stored language searches the DB without calling kards.com', async () => {
        getCardsDB.mockResolvedValue([{ title: 'TIGER I-H', imageURL: '/t.avif' }])

        const result = await getCards(searchVariables('ru-RU', 'тигр'))

        expect(fetchJson).not.toHaveBeenCalled()
        expect(getCardsDB).toHaveBeenCalled()
        expect(result.counter).toBe(1)
    })

    test('the short language code routes to the DB too', async () => {
        await getCards(searchVariables('ru', 'тигр'))

        expect(fetchJson).not.toHaveBeenCalled()
        expect(getCardsDB).toHaveBeenCalled()
    })

    test('an untranslated language still searches kards.com', async () => {
        fetchJson.mockResolvedValue(apiResponse(3))

        const result = await getCards(searchVariables('de-DE', 'panzer'))

        expect(fetchJson).toHaveBeenCalled()
        expect(getCardsDB).not.toHaveBeenCalled()
        expect(result.counter).toBe(3)
    })

    test('an untranslated language still falls back to the DB on no result', async () => {
        fetchJson.mockResolvedValue(apiResponse(0))

        await getCards(searchVariables('de-DE', 'panzer'))

        expect(fetchJson).toHaveBeenCalled()
        expect(getCardsDB).toHaveBeenCalled()
    })

    test('an untranslated language still falls back to the DB when the API fails', async () => {
        fetchJson.mockResolvedValue(undefined)

        await getCards(searchVariables('de-DE', 'panzer'))

        expect(getCardsDB).toHaveBeenCalled()
    })

    // The sync fetches every card with an empty q and language 'en'. It is what
    // fills fullText in the first place, so it must never be served from the DB.
    test('the sync fetch is not diverted to the DB', async () => {
        fetchJson.mockResolvedValue(apiResponse(2))

        const result = await getCards({
            language: 'en', q: '', showSpawnables: true, showReserved: true, first: 10000,
        }, 5000)

        expect(fetchJson).toHaveBeenCalled()
        expect(getCardsDB).not.toHaveBeenCalled()
        expect(result.cards).toHaveLength(2)
    })

    test('the DB latency is recorded in the caller timings, the API is not', async () => {
        const timings = {}

        await getCards(searchVariables('en-EN', 'tiger'), 3000, timings)

        expect(timings).toHaveProperty('db')
        expect(timings).not.toHaveProperty('api')
    })
})
