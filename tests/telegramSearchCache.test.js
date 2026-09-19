// Unit tests for the Telegram search cache: a repeat query replays the whole
// answer from Redis, skipping the DB lookup and both the download and the
// upload of every image. Redis and the Telegram context are mocked, so nothing
// is sent and no connection is opened.

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

const {getCards, getFiles} = require('../src/tools/search')
const handler = require('../src/controller/telegramHandler')

// A photo message shaped the way Telegram answers a successful send: the same
// image in several sizes, largest last.
function photoMessage(fileId) {
    return {photo: [{file_id: fileId + '_small'}, {file_id: fileId}]}
}

function makeRedis(store = {}) {
    return {
        store,
        exists: jest.fn(async key => (key in store ? 1 : 0)),
        get: jest.fn(async key => store[key] ?? null),
        set: jest.fn(async (key, value) => { store[key] = value }),
        del: jest.fn(async key => { delete store[key] }),
        expire: jest.fn(async () => 1),
        json: {
            get: jest.fn(async key => store[key] ?? null),
            set: jest.fn(async (key, path, value) => { store[key] = value }),
        },
    }
}

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
        replyWithPhoto: jest.fn(async () => photoMessage('FID1')),
        replyWithMediaGroup: jest.fn(async () => [
            photoMessage('FID1'), photoMessage('FID2'),
        ]),
        deleteMessage: jest.fn(async () => true),
        answerCbQuery: jest.fn(async () => true),
    }
}

const {getUser, updateUser} = require('../src/database/db')

beforeEach(() => {
    jest.clearAllMocks()
    getUser.mockResolvedValue({id: 7, status: 'active', language: 'en', name: 'alex'})
    updateUser.mockResolvedValue(true)
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    console.log.mockRestore()
    console.error.mockRestore()
})

// The key a single-card answer lands under: prefix, language, command, limit.
// The prefix is derived the way the handler derives it, so the tests do not
// silently pass against the wrong environment.
const keyPrefix = process.env.NODE_ENV === 'production' ? '' : 'dev:'
const singleKey = keyPrefix + 'telegram:search:en:zhukov:10'

describe('caching a fresh answer', () => {
    test('stores the counter and the file_id of every image sent', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).toHaveBeenCalledWith(
            singleKey, '$', {counter: 1, files: [{fileId: 'FID1', caption: ''}]})
        expect(redis.expire).toHaveBeenCalledWith(singleKey, expect.any(Number))
    })

    test('reads the id off the sent message, not off the file', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        getCards.mockResolvedValue({counter: 2, cards: [{}, {}]})
        getFiles.mockReturnValue([
            {attachment: 'a.webp', description: 'one'},
            {attachment: 'b.webp', description: 'two'},
        ])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).toHaveBeenCalledWith(singleKey, '$', {
            counter: 2,
            files: [
                {fileId: 'FID1', caption: 'one'},
                {fileId: 'FID2', caption: 'two'},
            ],
        })
    })

    // A failed send replies with plain text, which carries no photo. Caching
    // that would serve a broken answer for the life of the key.
    test('a failed send is not cached', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        tgCtx.replyWithPhoto.mockResolvedValue({message_id: 9}) // no photo
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).not.toHaveBeenCalled()
    })

    test('a partial media group is not cached', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        tgCtx.replyWithMediaGroup.mockResolvedValue([photoMessage('FID1')])
        getCards.mockResolvedValue({counter: 2, cards: [{}, {}]})
        getFiles.mockReturnValue([
            {attachment: 'a.webp', description: ''},
            {attachment: 'b.webp', description: ''},
        ])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).not.toHaveBeenCalled()
    })

    test('an empty result is not cached', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        getCards.mockResolvedValue({counter: 0, cards: []})

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).not.toHaveBeenCalled()
    })
})

describe('replaying a cached answer', () => {
    test('skips the DB lookup entirely', async () => {
        const redis = makeRedis({
            [singleKey]: {counter: 1, files: [{fileId: 'FID1', caption: ''}]},
        })
        const tgCtx = makeTgCtx()

        await handler.telegramHandler(tgCtx, redis)

        expect(getCards).not.toHaveBeenCalled()
        expect(tgCtx.replyWithPhoto).toHaveBeenCalledWith('FID1', {caption: ''})
    })

    test('replays several cards as one media group', async () => {
        const redis = makeRedis({
            [singleKey]: {counter: 2, files: [
                {fileId: 'FID1', caption: 'one'},
                {fileId: 'FID2', caption: 'two'},
            ]},
        })
        const tgCtx = makeTgCtx()

        await handler.telegramHandler(tgCtx, redis)

        expect(getCards).not.toHaveBeenCalled()
        expect(tgCtx.replyWithMediaGroup).toHaveBeenCalledWith([
            {type: 'photo', media: 'FID1', caption: 'one'},
            {type: 'photo', media: 'FID2', caption: 'two'},
        ])
    })

    test('reports the stored counter, not the number of images shown', async () => {
        const redis = makeRedis({
            [singleKey]: {counter: 30, files: [{fileId: 'FID1', caption: ''}]},
        })
        const tgCtx = makeTgCtx()

        await handler.telegramHandler(tgCtx, redis)

        expect(tgCtx.reply).toHaveBeenCalledWith(expect.stringContaining('30'))
    })

    test('an empty cache entry is treated as a miss', async () => {
        const redis = makeRedis({[singleKey]: {counter: 1, files: []}})
        const tgCtx = makeTgCtx()
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        expect(getCards).toHaveBeenCalled()
    })

    // A file_id can go stale before the key expires. Without this the query
    // would stay broken for the whole 90 days.
    test('a stale file_id drops the key and rebuilds the answer', async () => {
        const redis = makeRedis({
            [singleKey]: {counter: 1, files: [{fileId: 'STALE', caption: ''}]},
        })
        const tgCtx = makeTgCtx()
        tgCtx.replyWithPhoto
            .mockRejectedValueOnce(new Error('wrong file identifier'))
            .mockResolvedValue(photoMessage('FRESH'))
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.del).toHaveBeenCalledWith(singleKey)
        expect(getCards).toHaveBeenCalled()
        expect(redis.json.set).toHaveBeenCalledWith(
            singleKey, '$',
            {counter: 1, files: [{fileId: 'FRESH', caption: ''}]})
    })
})

describe('the cache key', () => {
    test('separates languages, so a RU answer is not served to an EN user', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        getUser.mockResolvedValue(
            {id: 7, status: 'active', language: 'ru', name: 'alex'})
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        expect(redis.json.set).toHaveBeenCalledWith(
            keyPrefix + 'telegram:search:ru:zhukov:10', '$', expect.anything())
    })

    // A group chat shows fewer cards than a private chat, so the two answers
    // cannot share a key.
    test('separates the attachment limit', async () => {
        const redis = makeRedis()
        const tgCtx = makeTgCtx()
        tgCtx.update.message.chat.type = 'group'
        getCards.mockResolvedValue({counter: 1, cards: [{}]})
        getFiles.mockReturnValue([{attachment: 'a.webp', description: ''}])

        await handler.telegramHandler(tgCtx, redis)

        const key = redis.json.set.mock.calls[0][0]
        expect(key).toBe(keyPrefix + 'telegram:search:en:zhukov:' +
            (parseInt(process.env.LIMIT) || 10))
    })
})
