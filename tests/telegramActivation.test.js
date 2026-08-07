// Telegram users are created 'pending' (for the Discord Terms gate) but have
// no terms flow of their own, so any interaction must activate them. This
// covers the button-tap path (telegramCallbackHandler), which previously
// created a pending user and blocked them without ever activating.

jest.mock('../src/database/db', () => ({
    getUser: jest.fn(),
    updateUser: jest.fn(async () => {}),
    getProfileStats: jest.fn(async () => ({
        total: 0, currentMonth: 0, allTimePosition: 0,
        currentMonthPosition: 0, lastDay: 0,
    })),
    getSynonym: jest.fn(),
    createMessage: jest.fn(async () => {}),
}))
jest.mock('../src/tools/translation/translator', () => ({
    translate: jest.fn((_lang, key) => key),
}))
jest.mock('../src/tools/profile', () => ({
    renderProfileText: jest.fn(() => 'profile'),
    reactionsLabel: jest.fn(() => 'reactions'),
}))
// The handler transitively requires redis-backed tools (roles, puppeteer);
// stub the client so requiring it doesn't open a real socket.
jest.mock('../src/controller/redis', () => ({
    redis: {json: {get: jest.fn(async () => null), set: jest.fn(async () => 'OK')}},
    cachePrefix: 'web:test:',
}))

const {telegramCallbackHandler} = require('../src/controller/telegramHandler')
const {getUser, updateUser} = require('../src/database/db')

function makeCallbackCtx(data = 'profile_show') {
    return {
        callbackQuery: {data, from: {id: 12345}},
        chat: {type: 'private'},
        answerCbQuery: jest.fn(async () => {}),
        editMessageText: jest.fn(async () => {}),
    }
}

beforeEach(() => {
    jest.clearAllMocks()
})

test('activates a pending Telegram user on a button tap', async () => {
    getUser.mockResolvedValue({id: 1, language: 'en', status: 'pending'})

    const ctx = makeCallbackCtx()
    await telegramCallbackHandler(ctx)

    // the pending user is flipped to active and persisted
    expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({id: 1, status: 'active'}))
    // and is NOT shown the blocked alert
    expect(ctx.answerCbQuery).not.toHaveBeenCalledWith(
        'blocked', expect.anything())
    // the profile view is rendered as for any active user
    expect(ctx.editMessageText).toHaveBeenCalled()
})

test('does not activate an admin-disabled (inactive) user', async () => {
    getUser.mockResolvedValue({id: 2, language: 'en', status: 'inactive'})

    const ctx = makeCallbackCtx()
    await telegramCallbackHandler(ctx)

    expect(updateUser).not.toHaveBeenCalled()
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('blocked', {show_alert: true})
    expect(ctx.editMessageText).not.toHaveBeenCalled()
})
