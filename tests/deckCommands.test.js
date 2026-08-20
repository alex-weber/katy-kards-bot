// Tests for handleAlt's command normalisation. The alt-art gallery is paged
// via commands "alt", "alt10", "alt20"… Custom aliases (e.g. "alt heinz") are
// resolved upstream, so anything reaching handleAlt that isn't "alt" + an
// offset must collapse to the first page ("alt"). A prior bug cached such
// commands verbatim (":alt:alt art") with a dead pagination link.
//
// Every collaborator that transitively connects to Redis at require-time is
// mocked so this suite exercises only handleAlt.

jest.mock('../src/controller/messageCache', () => ({
    cacheKeyPrefix: 'PRE:',
    getChannelScope: jest.fn(() => 'SCOPE:'),
    forwardCachedMessage: jest.fn(),
    cacheSentMessage: jest.fn(),
}))
jest.mock('../src/database/db', () => ({
    getAllSynonyms: jest.fn(),
}))
jest.mock('../src/tools/translation/translator', () => ({
    translate: jest.fn((_lang, key) => key),
}))
jest.mock('../src/tools/deck', () => ({createDeckImages: jest.fn()}))
jest.mock('../src/tools/button', () => ({getButtonRow: jest.fn(() => ['btn'])}))
jest.mock('../src/tools/search', () => ({isBotCommandChannel: jest.fn(() => true)}))
jest.mock('../src/tools/reactions', () => ({react: jest.fn()}))
jest.mock('../src/tools/roles', () => ({checkRoleDeckScreenshotLimit: jest.fn()}))
jest.mock('../src/tools/privateReply', () => ({sendPrivately: jest.fn()}))
jest.mock('../src/controller/bot', () => ({}))

const {getAllSynonyms} = require('../src/database/db')
const {cacheSentMessage} = require('../src/controller/messageCache')
const {handleAlt} = require('../src/controller/commands/deckCommands')

// 25 alt-art synonyms -> collectAltFiles yields 25 files (3 pages of 10).
function makeSynonyms(n = 25) {
    return Array.from({length: n}, (_, i) => ({
        key: 'alt card' + i,
        value: 'http://img/' + i + '.png',
    }))
}

function makeCtx(command) {
    let counter = 0
    return {
        command,
        message: {channel: {send: jest.fn(async () => ({id: 'sent' + counter++}))}},
        client: {},
        redis: {
            exists: jest.fn(async () => 0), // always a cache miss -> rebuild
            json: {get: jest.fn(), set: jest.fn()},
        },
        language: 'en',
        limit: 10,
        user: {id: 'u1'},
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    getAllSynonyms.mockResolvedValue(makeSynonyms())
})

// the cacheKey is the 2nd arg of cacheSentMessage(redis, cacheKey, sent, …)
const cachedKey = () => cacheSentMessage.mock.calls[0][1]
const sentAnswer = ctx => ctx.message.channel.send.mock.calls[0][0]

describe('handleAlt command normalisation', () => {
    test('returns false for a non-alt command', async () => {
        const ctx = makeCtx('foo')
        expect(await handleAlt(ctx)).toBe(false)
        expect(cacheSentMessage).not.toHaveBeenCalled()
    })

    test('"alt" serves the first page under the alt:alt key', async () => {
        const ctx = makeCtx('alt')
        expect(await handleAlt(ctx)).toBe(true)
        expect(cachedKey()).toBe('PRE:SCOPE:alt:alt')
        expect(sentAnswer(ctx).content).toContain('showing 1-10')
    })

    test('"alt art" collapses to the first page, not a phantom key', async () => {
        const ctx = makeCtx('alt art')
        expect(await handleAlt(ctx)).toBe(true)
        // must NOT be cached as ":alt:alt art"
        expect(cachedKey()).toBe('PRE:SCOPE:alt:alt')
        expect(sentAnswer(ctx).content).toContain('showing 1-10')
    })

    test('"alt not_a_key" also collapses to the first page', async () => {
        const ctx = makeCtx('alt not_a_key')
        expect(await handleAlt(ctx)).toBe(true)
        expect(cachedKey()).toBe('PRE:SCOPE:alt:alt')
    })

    test('"alt10" is valid pagination -> second page under alt:alt10', async () => {
        const ctx = makeCtx('alt10')
        expect(await handleAlt(ctx)).toBe(true)
        expect(cachedKey()).toBe('PRE:SCOPE:alt:alt10')
        expect(sentAnswer(ctx).content).toContain('showing 11-20')
    })
})
