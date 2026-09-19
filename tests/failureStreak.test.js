// Unit tests for the "three empty searches in a row -> show the help" streak:
// the counter itself, and the Telegram search path that drives it. Redis, the
// DB and the Telegram context are mocked, so nothing is sent and no connection
// is opened.

jest.mock('../src/database/db', () => ({
    getUser: jest.fn(),
    updateUser: jest.fn(),
    getSynonym: jest.fn(async () => null),
    createMessage: jest.fn(() => ({then: jest.fn()})),
    getProfileStats: jest.fn(),
    createUserAudit: jest.fn(),
}))
jest.mock('../src/tools/search', () => ({
    getCards: jest.fn(),
    getFiles: jest.fn(),
    isBotCommandChannel: jest.fn(() => false),
    isEnglishOnlyChannel: jest.fn(() => false),
}))
jest.mock('../src/tools/puppeteer', () => ({takeScreenshot: jest.fn()}))
jest.mock('../src/tools/deck', () => ({analyseDeck: jest.fn()}))
jest.mock('../src/tools/fileManager', () => ({
    getDeckFiles: jest.fn(), deleteDeckFiles: jest.fn(),
}))
jest.mock('../src/tools/imageUpload', () => ({
    downloadImageAsFile: jest.fn(), convertImageToWEBP: jest.fn(),
}))
jest.mock('../src/tools/stats', () => ({getStats: jest.fn()}))
jest.mock('../src/tools/profile', () => ({
    renderProfileText: jest.fn(), reactionsLabel: jest.fn(),
}))
jest.mock('../src/tools/roles', () => ({
    checkRoleCommandLimit: jest.fn(async () => ({allowed: true})),
    checkRoleDeckScreenshotLimit: jest.fn(async () => ({allowed: true})),
}))
jest.mock('../src/clients/telegram', () => ({
    telegramClient: false,
    telegramMessage: jest.fn(),
    getMediaGroup: jest.fn(files => files),
    Input: {fromLocalFile: jest.fn(path => ({localFile: path}))},
    Markup: {inlineKeyboard: jest.fn(), button: {callback: jest.fn()}},
}))

const {
    recordEmptySearch,
    clearEmptySearches,
    searchHelp,
} = require('../src/tools/failureStreak')
const {translate} = require('../src/tools/translation/translator')
const {getCards, getFiles, isBotCommandChannel} = require('../src/tools/search')
const {getUser, updateUser} = require('../src/database/db')
const handler = require('../src/controller/telegramHandler')
const {handleSearch} = require('../src/controller/commands/searchCommand')

function makeRedis(store = {}) {
    return {
        store,
        exists: jest.fn(async key => (key in store ? 1 : 0)),
        get: jest.fn(async key => store[key] ?? null),
        set: jest.fn(async (key, value) => { store[key] = value }),
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

const user = {id: 7}
// derived the way the module derives it, so the tests cannot pass against the
// wrong environment
const streakKey = (process.env.NODE_ENV === 'production'
    ? 'failures:' : 'dev:failures:') + user.id

const LANGUAGES = [
    'en', 'de', 'es', 'fr', 'it', 'jp', 'ko', 'pl', 'pt', 'ru', 'tw', 'zh',
]

describe('recordEmptySearch', () => {
    test('stays quiet for the first two misses', async () => {
        const redis = makeRedis()

        expect(await recordEmptySearch(redis, user)).toBe(false)
        expect(await recordEmptySearch(redis, user)).toBe(false)
    })

    test('asks for the help on the third miss', async () => {
        const redis = makeRedis()
        await recordEmptySearch(redis, user)
        await recordEmptySearch(redis, user)

        expect(await recordEmptySearch(redis, user)).toBe(true)
    })

    // Otherwise every further miss would repeat the whole command list.
    test('the streak restarts once the help has been shown', async () => {
        const redis = makeRedis()
        for (let i = 0; i < 3; i++) await recordEmptySearch(redis, user)

        expect(redis.store[streakKey]).toBeUndefined()
        expect(await recordEmptySearch(redis, user)).toBe(false)
        expect(await recordEmptySearch(redis, user)).toBe(false)
        expect(await recordEmptySearch(redis, user)).toBe(true)
    })

    // INCR leaves the key without a TTL, so an unarmed key would outlive the
    // window and make "three in a row" mean "three ever".
    test('every miss re-arms the expiry', async () => {
        const redis = makeRedis()
        await recordEmptySearch(redis, user)
        await recordEmptySearch(redis, user)

        expect(redis.expire).toHaveBeenCalledTimes(2)
        expect(redis.expire).toHaveBeenCalledWith(streakKey, expect.any(Number))
    })

    test('an answered search in between breaks the run', async () => {
        const redis = makeRedis()
        await recordEmptySearch(redis, user)
        await recordEmptySearch(redis, user)
        await clearEmptySearches(redis, user)

        expect(await recordEmptySearch(redis, user)).toBe(false)
    })

    // Two users failing twice each is not one user failing four times.
    test('the streak is counted per user', async () => {
        const redis = makeRedis()
        const other = {id: 8}
        await recordEmptySearch(redis, user)
        await recordEmptySearch(redis, user)

        expect(await recordEmptySearch(redis, other)).toBe(false)
        expect(await recordEmptySearch(redis, user)).toBe(true)
    })
})

describe('searchHelp', () => {
    test('is the /help text behind a localised lead-in', () => {
        const text = searchHelp('ru')

        expect(text).toContain(translate('ru', 'failureHelp'))
        expect(text).toContain(translate('ru', 'help'))
        // not the English fallback
        expect(text).not.toContain(translate('en', 'failureHelp'))
    })

    test('fences the command list for Discord on request', () => {
        expect(searchHelp('en', true)).toContain('```')
        expect(searchHelp('en')).not.toContain('```')
    })

    // A language missing from the preload would silently fall back to English
    // (see init.js), which is exactly what this feature must not do.
    test.each(LANGUAGES)('%s has its own lead-in', language => {
        const own = translate(language, 'failureHelp')

        expect(own).not.toBe('failureHelp')
        if (language !== 'en') expect(own).not.toBe(translate('en', 'failureHelp'))
    })

    // Discord rejects anything over 2000 characters, and the block is appended
    // to a "nothing found" reply.
    test.each(LANGUAGES)('%s fits in one Discord message', language => {
        const reply = translate(language, 'noresult') + '\n\n' +
            searchHelp(language, true)

        expect(reply.length).toBeLessThan(2000)
    })
})

describe('the Telegram search path', () => {
    function makeTgCtx() {
        return {
            update: {message: {
                text: '!zhukov',
                from: {id: 42, username: 'alex', is_bot: false},
                chat: {type: 'private'},
            }},
            chat: {type: 'private'},
            react: jest.fn(async () => true),
            reply: jest.fn(async () => ({message_id: 1})),
            replyWithPhoto: jest.fn(async () => (
                {photo: [{file_id: 'FID1_small'}, {file_id: 'FID1'}]})),
            replyWithMediaGroup: jest.fn(async () => []),
            deleteMessage: jest.fn(async () => true),
            answerCbQuery: jest.fn(async () => true),
        }
    }

    beforeEach(() => {
        jest.clearAllMocks()
        getUser.mockResolvedValue(
            {id: 7, status: 'active', language: 'en', name: 'alex'})
        updateUser.mockResolvedValue(true)
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        console.log.mockRestore()
        console.error.mockRestore()
    })

    // returns the text the bot replied with
    async function search(redis) {
        const tgCtx = makeTgCtx()
        await handler.telegramHandler(tgCtx, redis)

        return tgCtx.reply.mock.calls[0][0]
    }

    test('the third empty search carries the help, the first two do not', async () => {
        const redis = makeRedis()
        getCards.mockResolvedValue({counter: 0})

        const lead = translate('en', 'failureHelp')
        expect(await search(redis)).not.toContain(lead)
        expect(await search(redis)).not.toContain(lead)

        const third = await search(redis)
        expect(third).toContain(lead)
        expect(third).toContain(translate('en', 'help'))
        // the "nothing found" line is still there, the help is added to it
        expect(third).toContain(translate('en', 'noresult'))
    })

    test('the help is written in the user language', async () => {
        getUser.mockResolvedValue(
            {id: 7, status: 'active', language: 'ru', name: 'alex'})
        const redis = makeRedis()
        getCards.mockResolvedValue({counter: 0})
        await search(redis)
        await search(redis)

        expect(await search(redis)).toContain(translate('ru', 'failureHelp'))
    })

    test('an answered search in between resets the run', async () => {
        const redis = makeRedis()
        getCards.mockResolvedValue({counter: 0})
        await search(redis)
        await search(redis)

        // one search that finds a card
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])
        await handler.telegramHandler(makeTgCtx(), redis)

        getCards.mockResolvedValue({counter: 0})
        expect(await search(redis))
            .not.toContain(translate('en', 'failureHelp'))
    })
})

describe('the Discord search path', () => {
    // `replyPrivately` is what buildInteractionMessage hands a slash command:
    // present -> the reply is ephemeral, absent -> a legacy `!` command that
    // posts into the channel.
    function makeCtx(redis, {mode = null, slash = true, command = 'zzzzz'} = {}) {
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
            redis,
            language: 'en',
            command,
            limit: 5,
            paginationLimit: 10,
            user: {id: 7, mode},
            timings: {},
        }
    }

    // the text the user was shown, whichever channel it went out on
    function replyOf(ctx) {
        const privately = ctx.message.replyPrivately
        if (privately && privately.mock.calls.length) {
            return privately.mock.calls[0][0]
        }

        return ctx.message.channel.send.mock.calls[0][0]
    }

    async function emptySearch(redis, options) {
        const ctx = makeCtx(redis, options)
        await handleSearch(ctx)

        return {ctx, reply: replyOf(ctx)}
    }

    beforeEach(() => {
        jest.clearAllMocks()
        isBotCommandChannel.mockReturnValue(false)
        getCards.mockResolvedValue({counter: 0})
    })

    test('the third empty search carries the help, the first two do not', async () => {
        const redis = makeRedis()
        const lead = translate('en', 'failureHelp')

        expect((await emptySearch(redis)).reply).not.toContain(lead)
        expect((await emptySearch(redis)).reply).not.toContain(lead)

        const {reply} = await emptySearch(redis)
        expect(reply).toContain(lead)
        expect(reply).toContain(translate('en', 'help'))
        expect(reply).toContain(translate('en', 'noresult'))
    })

    // On a slash command it is the ephemeral ack that is edited, so the help
    // never reaches the channel.
    test('a slash command shows it privately', async () => {
        const redis = makeRedis()
        await emptySearch(redis)
        await emptySearch(redis)
        const {ctx} = await emptySearch(redis)

        expect(ctx.message.replyPrivately).toHaveBeenCalled()
        expect(ctx.message.channel.send).not.toHaveBeenCalled()
    })

    test('a legacy ! command posts it into the channel', async () => {
        const redis = makeRedis()
        const options = {slash: false}
        await emptySearch(redis, options)
        await emptySearch(redis, options)
        const {reply} = await emptySearch(redis, options)

        expect(reply).toContain(translate('en', 'failureHelp'))
    })

    test('the outcome is named in the log line', async () => {
        const redis = makeRedis()
        await emptySearch(redis)
        await emptySearch(redis)
        const {ctx} = await emptySearch(redis)

        expect(ctx.log.result).toBe('0 found (help shown)')
    })

    // A moderator note plus the help can exceed Discord's 2000-character
    // limit; the note is the part that gets dropped.
    test('a long moderator note gives way to the help', async () => {
        const redis = makeRedis()
        const mode = 'x'.repeat(1900)
        const options = {mode}

        const first = await emptySearch(redis, options)
        expect(first.reply).toContain(mode)

        await emptySearch(redis, options)
        const {reply} = await emptySearch(redis, options)
        expect(reply).not.toContain(mode)
        expect(reply).toContain(translate('en', 'failureHelp'))
        expect(reply.length).toBeLessThan(2000)
    })

    // A short note fits alongside the help, so both are kept.
    test('a short moderator note is kept alongside the help', async () => {
        const redis = makeRedis()
        const options = {mode: 'Please read the pinned post.'}
        await emptySearch(redis, options)
        await emptySearch(redis, options)
        const {reply} = await emptySearch(redis, options)

        expect(reply).toContain(options.mode)
        expect(reply).toContain(translate('en', 'failureHelp'))
    })

    test('an answered search in between resets the run', async () => {
        const redis = makeRedis()
        await emptySearch(redis)
        await emptySearch(redis)

        // a different query, so it is answered instead of replayed from the
        // cache the successful send leaves behind
        getCards.mockResolvedValue({counter: 1})
        getFiles.mockReturnValue([{attachment: 'a.webp'}])
        await handleSearch(makeCtx(redis, {command: 'zhukov'}))

        getCards.mockResolvedValue({counter: 0})
        expect((await emptySearch(redis)).reply)
            .not.toContain(translate('en', 'failureHelp'))
    })
})
