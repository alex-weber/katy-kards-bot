// Unit test for the once-per-day legacy-command deprecation nudge. Every
// handler module discordHandler.js pulls in is mocked (most transitively
// require ../controller/redis, which connects to Redis eagerly at require
// time) — this file only exercises warnLegacyCommand itself.

jest.mock('../src/database/db', () => ({
    createMessage: jest.fn(),
    updateUser: jest.fn(),
}))
jest.mock('../src/controller/messageContext', () => ({
    resolveButtonCommand: jest.fn(),
    loadUser: jest.fn(),
    checkUserStatus: jest.fn(),
    ensureUserName: jest.fn(),
    resolveLanguage: jest.fn(),
}))
jest.mock('../src/controller/commands/infoCommands', () => ({
    handleMidnight: jest.fn(), handleUtc: jest.fn(), handleStats: jest.fn(),
    handleDm: jest.fn(), handleContact: jest.fn(), handleLanguageSwitch: jest.fn(),
    handleHelp: jest.fn(), handleRanking: jest.fn(),
    handleMyRank: jest.fn(), handleProfile: jest.fn(), handleServers: jest.fn(),
}))
jest.mock('../src/controller/commands/deckCommands', () => ({
    handleDeck: jest.fn(), handleAlt: jest.fn(),
}))
jest.mock('../src/controller/commands/synonymCommands', () => ({
    handleManageSynonym: jest.fn(), handleListCommands: jest.fn(), resolveSynonym: jest.fn(),
}))
jest.mock('../src/controller/commands/topDeckCommand', () => ({
    handleTopDeck: jest.fn(),
}))
jest.mock('../src/controller/commands/searchCommand', () => ({
    handleSearch: jest.fn(),
}))
jest.mock('../src/tools/roles', () => ({
    checkRoleCommandLimit: jest.fn(),
}))
jest.mock('../src/tools/search', () => ({
    isBotCommandChannel: jest.fn(),
}))

const {warnLegacyCommand} = require('../src/controller/discordHandler')

function makeRedis({alreadyWarned = false, cachedLanguage} = {}) {
    return {
        set: jest.fn(async () => (alreadyWarned ? null : 'OK')),
        json: {
            get: jest.fn(async () => cachedLanguage ? {language: cachedLanguage} : null),
        },
    }
}

function makeMessage() {
    return {
        author: {id: 'u1'},
        channel: {send: jest.fn(async () => {})},
    }
}

describe('warnLegacyCommand', () => {
    test('sends the deprecation notice on first use', async () => {
        const redis = makeRedis()
        const message = makeMessage()

        await warnLegacyCommand(message, redis)

        expect(redis.set).toHaveBeenCalledWith(
            'deprecation:warned:u1', '1', {NX: true, EX: expect.any(Number)})
        expect(message.channel.send).toHaveBeenCalledTimes(1)
    })

    test('says nothing when already warned today (atomic NX)', async () => {
        const redis = makeRedis({alreadyWarned: true})
        const message = makeMessage()

        await warnLegacyCommand(message, redis)

        expect(message.channel.send).not.toHaveBeenCalled()
        // the language lookup is skipped too — no point once we're not sending
        expect(redis.json.get).not.toHaveBeenCalled()
    })

    test('uses the cached user\'s language when available', async () => {
        const redis = makeRedis({cachedLanguage: 'de'})
        const message = makeMessage()

        await warnLegacyCommand(message, redis)

        const sentText = message.channel.send.mock.calls[0][0]
        expect(sentText).not.toBe('') // translated text differs per language
    })

    test('does not throw when the channel send itself fails', async () => {
        const redis = makeRedis()
        const message = makeMessage()
        message.channel.send = jest.fn(() => Promise.reject(new Error('missing permission')))

        await expect(warnLegacyCommand(message, redis)).resolves.toBeUndefined()
    })
})
