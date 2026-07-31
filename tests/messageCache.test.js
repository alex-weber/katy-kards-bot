// Unit tests for the cache-forward mechanism: the Read Message History guard
// (canForwardInto) and the forward-with-pre-notice flow (forwardCachedMessage).
// No DB/Redis dependency — only discord.js and the translator (local files).

const {PermissionsBitField} = require('discord.js')
const {
    canForwardInto,
    forwardCachedMessage,
    getChannelScope,
} = require('../src/controller/messageCache')

describe('getChannelScope', () => {
    test('scopes a guild message to its channel, not just its guild', () => {
        const inChatChannel = {guildId: 'g1', channelId: 'c1'}
        const inBotCommands = {guildId: 'g1', channelId: 'c2'}

        // Same guild, different channels -> different namespaces, so a message
        // cached in one channel is never forwarded into another (which may
        // render the same query differently, e.g. with/without a Next button).
        expect(getChannelScope(inChatChannel))
            .not.toBe(getChannelScope(inBotCommands))
        expect(getChannelScope(inChatChannel)).toBe('guild:g1:channel:c1:')
    })

    test('is stable for the same guild+channel', () => {
        const a = {guildId: 'g1', channelId: 'c1'}
        const b = {guildId: 'g1', channelId: 'c1'}
        expect(getChannelScope(a)).toBe(getChannelScope(b))
    })

    test('scopes a DM by author and channel', () => {
        const dm = {channelId: 'dm1', author: {id: 'u1'}}
        expect(getChannelScope(dm)).toBe('user_command:u1:channel:dm1:')
    })
})

function makeTargetChannel({hasHistory = true, isDm = false} = {}) {
    return {
        sendRaw: jest.fn(async () => {}),
        send: jest.fn(async () => {}),
        permissionsFor: jest.fn(() => isDm ? null : {
            has: jest.fn(flag => flag === PermissionsBitField.Flags.ReadMessageHistory && hasHistory),
        }),
    }
}

describe('canForwardInto', () => {
    const client = {user: {id: 'bot-1'}}

    test('allows DM channels (no permission system)', () => {
        const channel = makeTargetChannel({isDm: true})
        expect(canForwardInto(client, channel)).toBe(true)
    })

    test('allows a guild channel where the bot has Read Message History', () => {
        const channel = makeTargetChannel({hasHistory: true})
        expect(canForwardInto(client, channel)).toBe(true)
    })

    test('blocks a guild channel where the bot lacks Read Message History', () => {
        const channel = makeTargetChannel({hasHistory: false})
        expect(canForwardInto(client, channel)).toBe(false)
    })
})

describe('forwardCachedMessage', () => {
    function makeForwardableMessage() {
        return {forward: jest.fn(async () => {})}
    }

    function makeClient(sourceChannel) {
        return {
            user: {id: 'bot-1'},
            channels: {fetch: jest.fn(async () => sourceChannel)},
            guilds: {fetch: jest.fn(async () => ({
                channels: {fetch: jest.fn(async () => sourceChannel)},
            }))},
        }
    }

    test('returns false immediately when there is nothing cached', async () => {
        const client = makeClient(null)
        const target = makeTargetChannel()
        const message = {channel: target}

        expect(await forwardCachedMessage(client, null, message)).toBe(false)
        expect(await forwardCachedMessage(client, {}, message)).toBe(false)
        expect(client.channels.fetch).not.toHaveBeenCalled()
    })

    test('returns false without fetching anything when the bot lacks permission', async () => {
        const client = makeClient(null)
        const target = makeTargetChannel({hasHistory: false})
        const message = {channel: target}

        const ok = await forwardCachedMessage(client, {id: 'm1'}, message)

        expect(ok).toBe(false)
        expect(client.channels.fetch).not.toHaveBeenCalled()
    })

    test('forwards a legacy (non-slash) message with no pre-forward notice', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {channel: target, channelId: 'c1', isSlash: false}

        const ok = await forwardCachedMessage(client, {id: 'm1'}, message)

        expect(ok).toBe(true)
        expect(target.sendRaw).not.toHaveBeenCalled()
        expect(forwardable.forward).toHaveBeenCalledWith(target)
    })

    test('sends the pre-forward notice for a slash message, before forwarding', async () => {
        const calls = []
        const forwardable = {forward: jest.fn(async () => { calls.push('forward') })}
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        target.sendRaw = jest.fn(async payload => { calls.push('notice:' + payload.content) })
        const message = {
            channel: target, channelId: 'c1', isSlash: true,
            // the name shown on this server, resolved where the interaction was
            // handled; author is kept for the DM/legacy fallback
            authorName: 'alice',
            author: {username: 'alice-unique'},
        }

        const ok = await forwardCachedMessage(client, {id: 'm1'}, message,
            {language: 'en', query: 'soviet infantry', key: 'cacheForwardNotice'})

        expect(ok).toBe(true)
        expect(calls[0]).toBe(
            'notice:Search request from alice: soviet infantry. Forwarding cached message.')
        expect(calls[1]).toBe('forward')
    })

    test('uses the generic notice key by default (e.g. for /deck and /alt)', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {
            channel: target, channelId: 'c1', isSlash: true,
            authorName: 'bob',
            author: {username: 'bob-unique'},
        }

        await forwardCachedMessage(client, {id: 'm1'}, message,
            {language: 'en', query: 'AAECAX...'})

        expect(target.sendRaw).toHaveBeenCalledWith({
            content: 'Request from bob: AAECAX.... Forwarding cached message.',
            allowedMentions: {parse: []},
        })
    })

    // The notice names the requester, and a nickname is theirs to choose.
    test('cannot be made to ping the server through the requester name', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {
            channel: target, channelId: 'c1', isSlash: true,
            authorName: '@everyone',
            author: {username: 'troll'},
        }

        await forwardCachedMessage(client, {id: 'm1'}, message,
            {language: 'en', query: 'x'})

        expect(target.sendRaw).toHaveBeenCalledWith(
            expect.objectContaining({allowedMentions: {parse: []}}))
    })

    // Nothing resolves a member in a DM, so the unique username is all there is.
    test('falls back to the username when no server name was resolved', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {
            channel: target, channelId: 'c1', isSlash: true,
            author: {username: 'bob-unique'},
        }

        await forwardCachedMessage(client, {id: 'm1'}, message,
            {language: 'en', query: 'AAECAX...'})

        expect(target.sendRaw).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Request from bob-unique: AAECAX.... Forwarding cached message.',
        }))
    })

    test('fetches the source message via the cached guild/channel when known', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {channel: target, channelId: 'fallback-channel', isSlash: false}

        await forwardCachedMessage(
            client, {id: 'm1', guildId: 'g1', channelId: 'source-channel'}, message)

        expect(client.guilds.fetch).toHaveBeenCalledWith('g1')
        expect(client.channels.fetch).not.toHaveBeenCalled()
    })

    test('falls back to the requesting channelId when the cache has no channel info', async () => {
        const forwardable = makeForwardableMessage()
        const sourceChannel = {messages: {fetch: jest.fn(async () => forwardable)}}
        const client = makeClient(sourceChannel)
        const target = makeTargetChannel()
        const message = {channel: target, channelId: 'fallback-channel', isSlash: false}

        await forwardCachedMessage(client, {id: 'm1'}, message)

        expect(client.channels.fetch).toHaveBeenCalledWith('fallback-channel')
    })

    test('returns false and does not throw on a recoverable Discord error', async () => {
        const client = makeClient(null)
        client.channels.fetch = jest.fn(async () => {
            const err = new Error('Unknown Message')
            err.code = 10008
            throw err
        })
        const target = makeTargetChannel()
        const message = {channel: target, channelId: 'c1', isSlash: false}

        await expect(forwardCachedMessage(client, {id: 'm1'}, message))
            .resolves.toBe(false)
    })

    test('returns false (not throw) on an unexpected error too', async () => {
        const client = makeClient(null)
        client.channels.fetch = jest.fn(async () => { throw new Error('boom') })
        const target = makeTargetChannel()
        const message = {channel: target, channelId: 'c1', isSlash: false}

        await expect(forwardCachedMessage(client, {id: 'm1'}, message))
            .resolves.toBe(false)
    })
})
