// Unit tests for the web router handlers. All data/IO dependencies are mocked
// so no DB, Redis, Discord or network access is required.

jest.mock('../src/database/db', () => ({
    getAllSynonyms: jest.fn(async () => []),
    getUser: jest.fn(),
    getUserById: jest.fn(),
    getMessages: jest.fn(),
    getUserMessages: jest.fn(),
    getProfileStats: jest.fn(),
    daysAgoString: jest.fn(n => `days-ago-${n}`),
}))
jest.mock('../src/controller/api', () => ({ run: jest.fn(async () => ({ success: true, data: [] })) }))
jest.mock('../src/tools/avatar', () => ({ resolveAvatarUrl: jest.fn(async () => 'http://avatar/x.webp') }))
jest.mock('../src/tools/search', () => ({ isManager: jest.fn(() => false) }))
jest.mock('axios', () => ({ get: jest.fn() }))

const db = require('../src/database/db')
const API = require('../src/controller/api')
const axios = require('axios')
const { isManager } = require('../src/tools/search')
const { resolveAvatarUrl } = require('../src/tools/avatar')
const router = require('../src/controller/router')

function makeRes() {
    const res = {}
    res.render = jest.fn()
    res.json = jest.fn()
    res.send = jest.fn()
    res.set = jest.fn(() => res)
    res.status = jest.fn(() => res)
    return res
}

beforeEach(() => jest.clearAllMocks())

describe('auth middleware', () => {
    test('isAuthenticated passes through logged-in users', () => {
        const next = jest.fn()
        router.isAuthenticated({ session: { user: { id: '1' } } }, makeRes(), next)
        expect(next).toHaveBeenCalledWith()
    })

    test('isAuthenticated skips the route for anonymous users', () => {
        const next = jest.fn()
        router.isAuthenticated({ session: {} }, makeRes(), next)
        expect(next).toHaveBeenCalledWith('route')
    })

    test('requireManager allows managers', () => {
        const next = jest.fn()
        const res = makeRes()
        router.requireManager({ session: { user: { isManager: true } } }, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    test('requireManager rejects non-managers with 403', () => {
        const next = jest.fn()
        const res = makeRes()
        router.requireManager({ session: { user: { isManager: false } } }, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.send).toHaveBeenCalledWith('Not permitted')
    })
})

describe('date range gating', () => {
    test('landing (anonymous) ignores from/to and disables the filter', () => {
        const res = makeRes()
        router.renderLanding({ session: {}, query: { from: '2020-01-01', to: '2020-02-01' } }, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.from).toBe('days-ago-30')
        expect(locals.canFilter).toBe(false)
    })

    test('dashboard (logged in) honors from/to and enables the filter', () => {
        const res = makeRes()
        const req = { session: { user: { id: '1' } }, query: { from: '2020-01-01', to: '2020-02-01' } }
        router.renderDashboard(req, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.from).toBe('2020-01-01')
        expect(locals.to).toBe('2020-02-01')
        expect(locals.canFilter).toBe(true)
    })

    test('handleApi clamps the range for anonymous callers', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'top-users' }, session: {}, query: { from: '2000-01-01', to: '2030-01-01' } },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.from).toBe('days-ago-30') // not 2000-01-01
        expect(res.json).toHaveBeenCalled()
    })

    test('handleApi honors the range for logged-in callers', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'top-users' }, session: { user: { id: '1' } }, query: { from: '2024-01-01', to: '2024-02-01' } },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.from).toBe('2024-01-01')
        expect(args.to).toBe('2024-02-01')
    })
})

describe('public profile', () => {
    test('rejects a non-numeric id with 404', async () => {
        const res = makeRes()
        await router.renderPublicProfile({ params: { id: 'abc' }, session: {} }, res)
        expect(res.status).toHaveBeenCalledWith(404)
        expect(db.getUserById).not.toHaveBeenCalled()
    })

    test('404 when the user does not exist', async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce(null)
        await router.renderPublicProfile({ params: { id: '5' }, session: {} }, res)
        expect(res.status).toHaveBeenCalledWith(404)
    })

    test("another user's profile shows stats only, no history, with avatar", async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce({ id: 5, name: 'Alice', discordId: '111' })
        db.getProfileStats.mockResolvedValueOnce({ total: 10, lastMonth: 4, lastDay: 1 })

        await router.renderPublicProfile({ params: { id: '5' }, session: {} }, res, { client: true })

        expect(db.getUserMessages).not.toHaveBeenCalled() // history stays private
        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(false)
        expect(locals.history).toBeNull()
        expect(locals.displayName).toBe('Alice')
        expect(locals.avatarUrl).toBe('http://avatar/x.webp')
        expect(resolveAvatarUrl).toHaveBeenCalled()
    })

    test('own profile via /profile/:id shows the private history', async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce({ id: 5, name: 'Me', discordId: '111' })
        db.getUserMessages.mockResolvedValueOnce({
            totalCount: 20,
            lastMonthMessagesCount: 8,
            lastDayMessages: [{ content: 'leo', createdAt: 'now' }],
        })

        await router.renderPublicProfile(
            { params: { id: '5' }, session: { user: { id: '111', username: 'Me' } } },
            res
        )

        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(true)
        expect(locals.history).toHaveLength(1)
        expect(locals.stats.total).toBe(20)
    })
})

describe('own profile (/profile)', () => {
    test('renders stats and history for the session user', async () => {
        const res = makeRes()
        db.getUser.mockResolvedValueOnce({ id: 5, discordId: '111' })
        db.getUserMessages.mockResolvedValueOnce({
            totalCount: 3,
            lastMonthMessagesCount: 2,
            lastDayMessages: [{ content: 'is2', createdAt: 'now' }],
        })

        await router.renderProfile({ session: { user: { id: '111', username: 'Me', avatar: 'abc' } } }, res)

        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(true)
        expect(locals.stats.lastDay).toBe(1)
        expect(locals.avatarUrl).toContain('cdn.discordapp.com/avatars/111/abc.webp')
    })
})

describe('manager pages', () => {
    test('renderCommands renders the synonyms view with the loaded list', async () => {
        const res = makeRes()
        db.getAllSynonyms.mockResolvedValueOnce([{ key: 'k', value: 'v' }])
        await router.renderCommands({ session: { user: { isManager: true } } }, res)
        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('synonyms')
        expect(locals.synonyms).toHaveLength(1)
    })

    test('renderMessages clamps pagination and sanitizes inputs', async () => {
        const res = makeRes()
        db.getMessages.mockResolvedValueOnce({ messages: [], totalCount: 120 })
        const req = {
            session: { user: { isManager: true } },
            query: { page: '-3', username: '  longusername_exceeding_twenty_chars  ', command: 'leo' },
        }
        await router.renderMessages(req, res)

        const passedToDb = db.getMessages.mock.calls[0][0]
        expect(passedToDb.page).toBe(1) // negative clamped to 1
        expect(passedToDb.username.length).toBeLessThanOrEqual(20)
        expect(passedToDb.username).toBe('longusername_exceedi') // trimmed + sliced

        const locals = res.render.mock.calls[0][1]
        expect(locals.totalPages).toBe(Math.ceil(120 / 50))
    })
})

describe('simple renders', () => {
    test('renderCards renders the cards view', async () => {
        const res = makeRes()
        await router.renderCards({ session: { user: { id: '1' } } }, res)
        expect(res.render.mock.calls[0][0]).toBe('cards')
    })

    test('renderServers passes the servers list', async () => {
        const res = makeRes()
        await router.renderServers({ session: { user: { id: '1' } } }, res, [{ name: 'guild' }])
        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('servers')
        expect(locals.servers).toEqual([{ name: 'guild' }])
    })

    test('renderAuth renders the auth view', () => {
        const res = makeRes()
        router.renderAuth({}, res)
        expect(res.render.mock.calls[0][0]).toBe('auth')
    })
})

describe('login / logout', () => {
    test('handleLogin stores the Discord user in a regenerated session', async () => {
        axios.get.mockResolvedValueOnce({ data: { id: '111', username: 'Me' } })
        db.getUser.mockResolvedValueOnce({ id: 5, discordId: '111' })
        isManager.mockReturnValueOnce(true)

        const session = {
            regenerate: jest.fn(cb => cb()),
            save: jest.fn(cb => cb()),
        }
        const res = makeRes()
        res.redirect = jest.fn()
        await router.handleLogin(
            { query: { tokenType: 'Bearer', accessToken: 'tok' }, session },
            res,
            jest.fn()
        )

        expect(session.user).toEqual({ id: '111', username: 'Me', isManager: true })
        expect(res.redirect).toHaveBeenCalledWith('/')
    })

    test('handleLogout clears and regenerates the session', () => {
        const session = {
            user: { id: '111' },
            save: jest.fn(cb => cb()),
            regenerate: jest.fn(cb => cb()),
        }
        const res = makeRes()
        res.redirect = jest.fn()
        router.handleLogout({ session }, res, jest.fn())
        expect(session.user).toBeNull()
        expect(res.redirect).toHaveBeenCalledWith('/')
    })
})
