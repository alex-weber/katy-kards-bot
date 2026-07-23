// Unit tests for the slash-command channel-attribution wrapper. Uses the real
// translator (cheap, no DB/Redis/network involved) like profileText.test.js.

const {attributeChannel} = require('../src/tools/attributedChannel')

function makeChannel(overrides = {}) {
    const sent = []
    return {
        sent,
        id: 'channel-1',
        send: jest.fn(async payload => {
            sent.push(payload)
            return {id: 'sent-message'}
        }),
        ...overrides,
    }
}

describe('attributeChannel', () => {
    test('passes through falsy channels untouched (no Proxy-construction crash)', () => {
        expect(attributeChannel(null, {username: 'alice'}, 'en')).toBeNull()
        expect(attributeChannel(undefined, {username: 'alice'}, 'en')).toBeUndefined()
    })

    test('prefixes a string payload with the requester tag', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')
        await wrapped.send('hello world')

        expect(channel.sent[0]).toBe('_Requested by alice_\nhello world')
    })

    test('prefixes an object payload content, preserving other fields', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')
        await wrapped.send({content: 'cards found', components: ['btn']})

        expect(channel.sent[0]).toEqual({
            content: '_Requested by alice_\ncards found',
            components: ['btn'],
        })
    })

    test('sets content on a payload that had none (e.g. files-only)', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')
        await wrapped.send({files: ['a.png']})

        expect(channel.sent[0]).toEqual({
            files: ['a.png'],
            content: '_Requested by alice_',
        })
    })

    test('includes the query in the tag when provided', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en', 'soviet infantry 1/8')
        await wrapped.send('search results')

        expect(channel.sent[0]).toBe(
            '_Requested from alice: soviet infantry 1/8_\nsearch results')
    })

    test('falls back to the plain tag when no query is known', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')
        await wrapped.send('page 2')

        expect(channel.sent[0]).toBe('_Requested by alice_\npage 2')
    })

    // Discord rejects `content` on a forward payload with API error 160011
    // ("Forward messages cannot have additional content") — this is the
    // exact bug this bypass fixes.
    test('leaves a forward payload completely untouched', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en', 'soviet infantry')
        const forwardPayload = {forward: {message: '1', channel: '2', guild: '3'}}
        await wrapped.send(forwardPayload)

        expect(channel.sent[0]).toBe(forwardPayload)
        expect(channel.sent[0]).not.toHaveProperty('content')
    })

    test('sendRaw bypasses attribution entirely', async () => {
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en', 'soviet infantry')
        await wrapped.sendRaw('already-formatted notice')

        expect(channel.sent[0]).toBe('already-formatted notice')
    })

    test('other properties and methods pass through to the real channel', () => {
        const channel = makeChannel({id: 'real-id', name: 'general'})
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')

        expect(wrapped.id).toBe('real-id')
        expect(wrapped.name).toBe('general')
    })

    test('methods relying on private class fields work through the proxy', () => {
        // Regression guard for the Proxy `receiver` footgun: discord.js
        // classes use private (#) fields, and invoking a method/getter with
        // the Proxy itself as `this` throws "Cannot read private member from
        // an object whose class did not declare it". attributeChannel avoids
        // this by omitting `receiver` from Reflect.get.
        class ChannelWithPrivateField {
            #secret = 'hidden'
            constructor() { this.id = '123' }
            get label() { return 'channel-' + this.#secret }
            async send(payload) { return payload }
        }

        const wrapped = attributeChannel(
            new ChannelWithPrivateField(), {username: 'alice'}, 'en')

        expect(wrapped.label).toBe('channel-hidden')
    })

    test('forwards the send call to the real target, not the proxy', async () => {
        // Verifies the returned .send closure is bound to `target`, so
        // internal `this` references inside the real send() still resolve.
        const channel = makeChannel()
        const wrapped = attributeChannel(channel, {username: 'alice'}, 'en')
        await wrapped.send('x')

        expect(channel.send).toHaveBeenCalledTimes(1)
    })
})
