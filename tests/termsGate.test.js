// Unit tests for the Terms of Service gate and its command. termsCommands has
// no DB/Redis/network dependencies, so nothing needs mocking here.

const {
    requiresTermsAcceptance,
    getTermsDecisionRow,
    buildTermsView,
    handleTermsGate,
    handleTerms,
} = require('../src/controller/commands/termsCommands')

function makeCtx({status = 'active', command = 'search'} = {}) {
    const send = jest.fn(async () => {})
    return {
        ctx: {
            command,
            language: 'en',
            user: {status},
            message: {channel: {send}},
        },
        send,
    }
}

describe('requiresTermsAcceptance', () => {
    test.each([
        ['pending', true],
        ['declined', true],
        ['active', false],
        ['inactive', false],
    ])('status %s -> %s', (status, expected) => {
        expect(requiresTermsAcceptance({status})).toBe(expected)
    })
})

describe('getTermsDecisionRow', () => {
    function buttons(user) {
        return getTermsDecisionRow('en', user)[0].components
    }

    test('Accept is enabled for a pending user', () => {
        const [accept, decline] = buttons({status: 'pending'})
        expect(accept.data.custom_id).toBe('terms_accept')
        expect(accept.data.disabled).toBeFalsy()
        expect(decline.data.custom_id).toBe('terms_decline')
    })

    test('Accept is greyed out for an already-accepted user', () => {
        const [accept] = buttons({status: 'active'})
        expect(accept.data.disabled).toBe(true)
    })
})

describe('handleTermsGate', () => {
    test('gates a normal command for a pending user (shows message, stops)', async () => {
        const {ctx, send} = makeCtx({status: 'pending', command: 'search'})
        expect(await handleTermsGate(ctx)).toBe(true)
        expect(send).toHaveBeenCalledTimes(1)
    })

    test('gates a normal command for a declined user', async () => {
        const {ctx, send} = makeCtx({status: 'declined', command: 'leo'})
        expect(await handleTermsGate(ctx)).toBe(true)
        expect(send).toHaveBeenCalledTimes(1)
    })

    test('lets the terms command through for a pending user', async () => {
        const {ctx, send} = makeCtx({status: 'pending', command: 'terms'})
        expect(await handleTermsGate(ctx)).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })

    test('does not gate active users', async () => {
        const {ctx, send} = makeCtx({status: 'active', command: 'search'})
        expect(await handleTermsGate(ctx)).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })
})

describe('buildTermsView', () => {
    test('contains the explanation and the Accept/Decline buttons', () => {
        const view = buildTermsView('en', {status: 'pending'})
        expect(typeof view.content).toBe('string')
        expect(view.content.length).toBeGreaterThan(50)
        const ids = view.components[0].components.map(c => c.data.custom_id)
        expect(ids).toEqual(['terms_accept', 'terms_decline'])
    })
})

describe('handleTerms', () => {
    test('shows the "Read Terms" prompt (content + button) for the terms command', async () => {
        const {ctx, send} = makeCtx({command: 'terms'})
        expect(await handleTerms(ctx)).toBe(true)
        const arg = send.mock.calls[0][0]
        expect(arg).toHaveProperty('content')
        // the public prompt carries the terms_show button, not accept/decline
        expect(arg.components[0].components[0].data.custom_id).toBe('terms_show')
    })

    test('ignores other commands', async () => {
        const {ctx, send} = makeCtx({command: 'search'})
        expect(await handleTerms(ctx)).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })
})
