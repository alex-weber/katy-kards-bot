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
