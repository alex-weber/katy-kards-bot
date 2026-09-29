// listSynonyms() splits the /commands list into message-sized pages. When the
// page limit is hit and every synonym after it is unlisted (e.g. redirects),
// the last page is empty - that must not throw away the full pages before it.

process.env.MESSAGE_MAX_LENGTH = '20'

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

const { listSynonyms } = require('../src/tools/search')
const { getAllSynonyms } = require('../src/database/db')

afterAll(() => {
    delete process.env.MESSAGE_MAX_LENGTH
})

test('keeps the full pages when only unlisted synonyms follow the limit', async () => {
    getAllSynonyms.mockResolvedValue([
        { key: 'aaaaaaaaaa', value: 'text:one' },
        { key: 'bbbbbbbbbb', value: 'text:two' },
        //a redirect is not listed, so the page opened for it stays empty
        { key: 'cccccccccc', value: 'tiger' },
    ])

    expect(await listSynonyms('commands')).toEqual([['aaaaaaaaaa', 'bbbbbbbbbb']])
})

test('starts a new page once the limit is exceeded', async () => {
    getAllSynonyms.mockResolvedValue([
        { key: 'aaaaaaaaaa', value: 'text:one' },
        { key: 'bbbbbbbbbb', value: 'text:two' },
        { key: 'cccccccccc', value: 'text:three' },
    ])

    expect(await listSynonyms('commands'))
        .toEqual([['aaaaaaaaaa', 'bbbbbbbbbb'], ['cccccccccc']])
})

test('returns null when nothing is listable', async () => {
    getAllSynonyms.mockResolvedValue([{ key: 'cccccccccc', value: 'tiger' }])

    expect(await listSynonyms('commands')).toBeNull()
})
