// Unit tests for the blocked-user predicate shared between the legacy `!`
// pipeline (checkUserStatus) and the slash-command gate (isUserBlocked is
// imported directly by slashHandler.js's loadGatedUser). Redis is mocked
// because messageContext.js pulls in ../database/db, which eagerly connects
// to Redis at require time via database/message.js.

jest.mock('../src/controller/redis', () => ({
    redis: {
        json: {get: jest.fn(async () => null), set: jest.fn(async () => 'OK')},
    },
    cachePrefix: 'web:test:',
}))

const {isUserBlocked, checkUserStatus} = require('../src/controller/messageContext')

describe('isUserBlocked', () => {
    test.each([
        ['active', false],
        ['pending', false], // needs to accept terms, not "blocked"
        ['declined', false], // same — terms gate handles these, not the block gate
        ['inactive', true],
        [undefined, true],
    ])('status %s -> blocked %s', (status, expected) => {
        expect(isUserBlocked({status})).toBe(expected)
    })
})

describe('checkUserStatus', () => {
    function makeMessage() {
        return {
            react: jest.fn(async () => {}),
            channel: {send: jest.fn(async () => {})},
        }
    }

    test('does not gate an active user', () => {
        const message = makeMessage()
        expect(checkUserStatus({status: 'active'}, message)).toBe(false)
        expect(message.react).not.toHaveBeenCalled()
    })

    test('does not gate a terms-pending user (terms gate handles them)', () => {
        const message = makeMessage()
        expect(checkUserStatus({status: 'pending'}, message)).toBe(false)
        expect(message.react).not.toHaveBeenCalled()
    })

    test('reacts and stops for a blocked user', () => {
        const message = makeMessage()
        expect(checkUserStatus({status: 'inactive'}, message)).toBe(true)
        expect(message.react).toHaveBeenCalledWith('🚫')
    })

    test('shows the moderator-set custom message when present', () => {
        const message = makeMessage()
        checkUserStatus({status: 'inactive', mode: 'appeal in #support'}, message)

        expect(message.channel.send).toHaveBeenCalledWith('appeal in #support')
    })

    test('sends nothing extra when no custom message is set', () => {
        const message = makeMessage()
        checkUserStatus({status: 'inactive'}, message)

        expect(message.channel.send).not.toHaveBeenCalled()
    })
})
