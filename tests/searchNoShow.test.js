// Unit tests for the ">20 cards, refusing to show anything" reply: who gets to
// see it. A query that is too broad is the user's to narrow down, so wherever
// there is a private channel for it (the slash path) the refusal goes to them
// alone instead of into the chat. Redis, the DB and the card lookup are mocked,
// so nothing is fetched and no connection is opened.

jest.mock('../src/tools/search', () => ({
    getCards: jest.fn(),
    getFiles: jest.fn(() => []),
    isBotCommandChannel: jest.fn(() => false),
    isEnglishOnlyChannel: jest.fn(() => false),
}))

const {handleSearch} = require('../src/controller/commands/searchCommand')
const {translate} = require('../src/tools/translation/translator')
const {getCards, getFiles, isBotCommandChannel} =
    require('../src/tools/search')

// more than the hard-coded threshold of 20
const tooMany = 45

function makeRedis(store = {}) {
    return {
        store,
        exists: jest.fn(async key => (key in store ? 1 : 0)),
        del: jest.fn(async key => { delete store[key] }),
        expire: jest.fn(async () => 1),
        incr: jest.fn(async key => {
            store[key] = (parseInt(store[key]) || 0) + 1

            return store[key]
        }),
        json: {
            get: jest.fn(async key => store[key] ?? null),
            set: jest.fn(async (key, path, value) => { store[key] = value }),
        },
    }
}

// `replyPrivately` is what buildInteractionMessage hands a slash command;
// a legacy `!` command has no such channel and only has the chat.
function makeCtx({slash = true} = {}) {
    const message = {
        channelId: 'c1',
        guildId: 'g1',
        channel: {send: jest.fn(async () => ({id: 'm1'}))},
        buttonId: undefined,
    }
    if (slash) message.replyPrivately = jest.fn(async () => {})

    return {
        message,
        client: {},
        redis: makeRedis(),
        language: 'en',
        command: 'soviet',
        limit: 5,
        paginationLimit: 10,
        user: {id: 7, mode: null},
        timings: {},
    }
}

const refusal = translate('en', 'search') + ': ' + tooMany +
    translate('en', 'noshow')

beforeEach(() => {
    jest.clearAllMocks()
    isBotCommandChannel.mockReturnValue(false)
    getCards.mockResolvedValue({counter: tooMany})
    getFiles.mockReturnValue([])
})

describe('a query with too many results, outside a bot-command channel', () => {
    test('a slash command is refused privately, not in the chat', async () => {
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(ctx.message.replyPrivately).toHaveBeenCalledWith(refusal)
        expect(ctx.message.channel.send).not.toHaveBeenCalled()
    })

    test('a legacy ! command still posts it into the channel', async () => {
        const ctx = makeCtx({slash: false})

        await handleSearch(ctx)

        expect(ctx.message.channel.send).toHaveBeenCalledWith(refusal)
    })

    test('the log line is unchanged', async () => {
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(ctx.log.result).toBe(tooMany + ' found (hidden)')
    })

    // The refusal is not a miss: the cards exist, they are just too many to
    // post. It must not push the user towards the help text.
    test('it does not count as an empty search', async () => {
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(ctx.redis.incr).not.toHaveBeenCalled()
    })
})

// In a bot-command channel the cards are posted as before; flooding is the
// point of that channel.
test('a bot-command channel still gets the cards', async () => {
    isBotCommandChannel.mockReturnValue(true)
    getFiles.mockReturnValue([{attachment: 'a.webp'}])
    const ctx = makeCtx()

    await handleSearch(ctx)

    expect(ctx.message.replyPrivately).not.toHaveBeenCalled()
    expect(ctx.message.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({files: [{attachment: 'a.webp'}]}))
})

// A cache hit is replayed by forwarding the original message, which drops its
// "Next" button, and the cache key has no offset. So only a result that fits in
// one message is cached; anything longer is sent fresh every time, with the
// pagination state kept apart in cmdCacheKey.
describe('caching a search result', () => {
    const cacheKey = 'discord:dev:guild:g1:channel:c1:en:soviet5'
    const cachedKeys = ctx => ctx.redis.json.set.mock.calls
        .map(([key]) => key)
        .filter(key => key && key.startsWith('discord:'))

    beforeEach(() => isBotCommandChannel.mockReturnValue(true))

    test('a single-page result is cached as such', async () => {
        getCards.mockResolvedValue({counter: 4})
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(cachedKeys(ctx)).toEqual([cacheKey])
        expect(ctx.redis.store[cacheKey]).toMatchObject({singlePage: true})
    })

    test('a paginated first page is not cached', async () => {
        getCards.mockResolvedValue({counter: 8})
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(ctx.message.channel.send.mock.calls[0][0].components)
            .toBeDefined()
        expect(cachedKeys(ctx)).toHaveLength(0)
    })

    test('a later page is not cached over the first', async () => {
        getCards.mockResolvedValue({counter: 8})
        const ctx = makeCtx()
        ctx.message.buttonId = 'next_button_soviet'
        ctx.message.language = 'en'
        ctx.cmdCacheKey = 'command:next_button_soviet'
        ctx.redis.store[ctx.cmdCacheKey] = {offset: 5}

        await handleSearch(ctx)

        expect(ctx.message.channel.send).toHaveBeenCalled()
        expect(cachedKeys(ctx)).toHaveLength(0)
    })

    // e.g. the result shrank between pages, or a count came back wrong: the
    // page must still not replace the first page's entry
    test('a later page is not cached even if its count fits', async () => {
        getCards.mockResolvedValue({counter: 4})
        const ctx = makeCtx()
        ctx.message.buttonId = 'next_button_soviet'
        ctx.message.language = 'en'
        ctx.cmdCacheKey = 'command:next_button_soviet'
        ctx.redis.store[ctx.cmdCacheKey] = {offset: 5}

        await handleSearch(ctx)

        expect(ctx.message.channel.send).toHaveBeenCalled()
        expect(cachedKeys(ctx)).toHaveLength(0)
    })

    // no button here, but the reply still shows only the first `limit` cards
    test('a cut-off result in a chat channel is not cached', async () => {
        isBotCommandChannel.mockReturnValue(false)
        getCards.mockResolvedValue({counter: 8})
        const ctx = makeCtx()

        await handleSearch(ctx)

        expect(ctx.message.channel.send).toHaveBeenCalled()
        expect(cachedKeys(ctx)).toHaveLength(0)
    })

    // entries from before the single-page rule may hold one page of a longer
    // result; they are dropped and the search runs again
    test('an old entry without the single-page mark is dropped', async () => {
        getCards.mockResolvedValue({counter: 8})
        const ctx = makeCtx()
        ctx.redis.store[cacheKey] = {id: 'old', channelId: 'c1', guildId: 'g1'}

        await handleSearch(ctx)

        expect(ctx.redis.del).toHaveBeenCalledWith(cacheKey)
        expect(getCards).toHaveBeenCalled()
        expect(cacheKey in ctx.redis.store).toBe(false)
    })
})
