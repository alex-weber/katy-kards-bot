// Tests for handleAlt. The alt-art gallery is paged via commands "alt",
// "alt10", "alt20"… Custom aliases (e.g. "alt heinz") are resolved upstream,
// so anything reaching handleAlt that isn't "alt" + an offset must collapse to
// the first page ("alt").
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
jest.mock('../src/tools/roles', () => ({checkRoleDeckScreenshotLimit: jest.fn()}))
jest.mock('../src/tools/privateReply', () => ({sendPrivately: jest.fn()}))
jest.mock('../src/controller/bot', () => ({}))

const {getAllSynonyms} = require('../src/database/db')
const {cacheSentMessage, forwardCachedMessage} =
    require('../src/controller/messageCache')
const {getButtonRow} = require('../src/tools/button')
const {isBotCommandChannel} = require('../src/tools/search')
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
            exists: jest.fn(async () => 1),
            json: {get: jest.fn(async () => ({id: 'old'})), set: jest.fn()},
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

const sentAnswer = ctx => ctx.message.channel.send.mock.calls[0][0]
const buttonId = () => getButtonRow.mock.calls[0][1]

describe('handleAlt command normalisation', () => {
    test('returns false for a non-alt command', async () => {
        const ctx = makeCtx('foo')
        expect(await handleAlt(ctx)).toBe(false)
        expect(ctx.message.channel.send).not.toHaveBeenCalled()
    })

    test('"alt" serves the first page', async () => {
        const ctx = makeCtx('alt')
        expect(await handleAlt(ctx)).toBe(true)
        expect(sentAnswer(ctx).content).toContain('showing 1-10')
        expect(buttonId()).toBe('next_button_alt10')
    })

    test('"alt art" collapses to the first page', async () => {
        const ctx = makeCtx('alt art')
        expect(await handleAlt(ctx)).toBe(true)
        expect(sentAnswer(ctx).content).toContain('showing 1-10')
        expect(buttonId()).toBe('next_button_alt10')
    })

    test('"alt not_a_key" also collapses to the first page', async () => {
        const ctx = makeCtx('alt not_a_key')
        expect(await handleAlt(ctx)).toBe(true)
        expect(sentAnswer(ctx).content).toContain('showing 1-10')
    })

    test('"alt10" is valid pagination -> second page', async () => {
        const ctx = makeCtx('alt10')
        expect(await handleAlt(ctx)).toBe(true)
        expect(sentAnswer(ctx).content).toContain('showing 11-20')
        expect(buttonId()).toBe('next_button_alt20')
    })
})

// A cached page was replayed by forwarding it, which drops its "Next" button,
// and rebuilding the button around the forward kept going wrong. The gallery
// always runs to several pages, so it is not cached at all: every page is a
// fresh message with its own button.
describe('handleAlt pages are always sent fresh', () => {
    test('an old cache entry is neither forwarded nor rewritten', async () => {
        const ctx = makeCtx('alt')
        await handleAlt(ctx)
        expect(forwardCachedMessage).not.toHaveBeenCalled()
        expect(cacheSentMessage).not.toHaveBeenCalled()
        expect(sentAnswer(ctx).files).toHaveLength(10)
        expect(sentAnswer(ctx).components).toEqual(['btn'])
    })

    test('the last page gets no button', async () => {
        const ctx = makeCtx('alt20')
        await handleAlt(ctx)
        expect(sentAnswer(ctx).content).toContain('showing 21-25')
        expect(sentAnswer(ctx).components).toBeUndefined()
    })

    test('no button outside bot-command channels', async () => {
        isBotCommandChannel.mockReturnValueOnce(false)
        const ctx = makeCtx('alt')
        await handleAlt(ctx)
        expect(sentAnswer(ctx).components).toBeUndefined()
    })
})
