// Unit tests for the slash-vs-legacy "nothing found" reply helper. No
// DB/Redis/network dependencies, nothing to mock.

const {sendPrivately} = require('../src/tools/privateReply')

describe('sendPrivately', () => {
    test('uses message.replyPrivately when present (slash path)', async () => {
        const replyPrivately = jest.fn(async () => {})
        const channelSend = jest.fn(async () => {})
        const message = {replyPrivately, channel: {send: channelSend}}

        await sendPrivately(message, 'no results found')

        expect(replyPrivately).toHaveBeenCalledWith('no results found')
        expect(channelSend).not.toHaveBeenCalled()
    })

    test('falls back to message.channel.send when absent (legacy path)', async () => {
        const channelSend = jest.fn(async () => {})
        const message = {channel: {send: channelSend}}

        await sendPrivately(message, 'no results found')

        expect(channelSend).toHaveBeenCalledWith('no results found')
    })
})
