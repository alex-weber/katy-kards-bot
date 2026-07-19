// Unit tests for the web router handlers. All data/IO dependencies are mocked
// so no DB, Redis, Discord or network access is required.

jest.mock('../src/database/db', () => ({
    getAllSynonyms: jest.fn(async () => []),
    getUser: jest.fn(),
    getUserById: jest.fn(),
    getUsers: jest.fn(),
    getMessages: jest.fn(),
    getUserMessages: jest.fn(),
    getProfileStats: jest.fn(),
    updateUserAdminFields: jest.fn(),
    getTopDeckRanking: jest.fn(),
}))
jest.mock('../src/controller/api', () => ({ run: jest.fn(async () => ({ success: true, data: [] })) }))
jest.mock('../src/controller/redis', () => ({
    redis: {
        del: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
        get: jest.fn(async () => null),
        incr: jest.fn(async () => 1),
        info: jest.fn(async () => [
            '# Server',
            'redis_version:7.2.0',
            'uptime_in_seconds:6000',
            '# Clients',
            'connected_clients:2',
            'blocked_clients:0',
            '# Memory',
            'used_memory:1024',
            'used_memory_human:1.00K',
            'used_memory_rss:2048',
            'used_memory_rss_human:2.00K',
            'used_memory_peak:4096',
            'used_memory_peak_human:4.00K',
            'mem_fragmentation_ratio:2.0',
            '# Stats',
            'total_commands_processed:10',
            'instantaneous_ops_per_sec:1',
            'keyspace_hits:8',
            'keyspace_misses:2',
            'expired_keys:3',
            'evicted_keys:1',
            '# Replication',
            'role:master',
        ].join('\r\n')),
        set: jest.fn(async () => 'OK'),
        json: {
            get: jest.fn(async () => null),
            set: jest.fn(async () => 'OK'),
        },
    },
    cachePrefix: 'web:test:',
}))
jest.mock('../src/controller/messageCache', () => ({ cacheKeyPrefix: 'discord:test:' }))
jest.mock('../src/tools/avatar', () => ({ resolveAvatarUrl: jest.fn(async () => 'http://avatar/x.webp') }))
jest.mock('../src/tools/search', () => ({ isManager: jest.fn(() => false) }))
jest.mock('axios', () => ({ get: jest.fn() }))

const db = require('../src/database/db')
const API = require('../src/controller/api')
const axios = require('axios')
const { isManager } = require('../src/tools/search')
const { resolveAvatarUrl } = require('../src/tools/avatar')
const router = require('../src/controller/router')
const { redis } = require('../src/controller/redis')
const {
    detectMemoryJump,
    getNodeMemoryAvailableMb,
    getRedisMemoryAvailableMb,
    getSampleTimeSpan,
} = require('../src/tools/systemMetrics')

function makeRes() {
    const res = {}
    res.render = jest.fn()
    res.json = jest.fn()
    res.send = jest.fn()
    res.set = jest.fn(() => res)
    res.status = jest.fn(() => res)
    return res
}

beforeEach(() => {
    jest.clearAllMocks()
    redis.json.get.mockResolvedValue(null)
    redis.get.mockResolvedValue(null)
})

describe('auth middleware', () => {
    test('isAuthenticated passes through logged-in users', async () => {
        const next = jest.fn()
        db.getUser.mockResolvedValueOnce({ id: 1, discordId: '1', role: 'GOD' })
        await router.isAuthenticated({ session: { user: { id: '1' } } }, makeRes(), next)
        expect(next).toHaveBeenCalledWith()
    })

    test('isAuthenticated skips the route for anonymous users', async () => {
        const next = jest.fn()
        await router.isAuthenticated({ session: {} }, makeRes(), next)
        expect(next).toHaveBeenCalledWith('route')
    })

    test('requireManager allows managers', async () => {
        const next = jest.fn()
        const res = makeRes()
        db.getUser.mockResolvedValueOnce({ id: 1, discordId: '1', role: 'VIP' })
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        await router.requireManager({ session: { user: { id: '1', isManager: true } } }, res, next)
        expect(next).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalled()
    })

    test('requireManager rejects non-managers with 403', async () => {
        const next = jest.fn()
        const res = makeRes()
        db.getUser.mockResolvedValueOnce({ id: 1, discordId: '1', role: null })
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        await router.requireManager({ session: { user: { id: '1', isManager: true } } }, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.send).toHaveBeenCalledWith('Not permitted')
    })

    test('requireGod hydrates stale sessions before allowing /roles', async () => {
        const next = jest.fn()
        const res = makeRes()
        const req = { session: { user: { id: '1', isManager: true } } }
        db.getUser.mockResolvedValueOnce({ id: 1, discordId: '1', role: 'GOD' })
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')

        await router.requireGod(req, res, next)

        expect(next).toHaveBeenCalled()
        expect(req.session.user.role).toBe('GOD')
        expect(req.session.user.isManager).toBe(true)
    })
})

describe('stats period selection', () => {
    test('landing defaults to daily and exposes the allowed periods', () => {
        const res = makeRes()
        router.renderLanding({ session: {}, query: {period: 'weekly'} }, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.period).toBe('daily')
        expect(locals.periods).toEqual([
            {value: 'daily', label: 'Last 30 days'},
            {value: 'monthly', label: 'Last 12 months'},
            {value: 'quarterly', label: 'Last 8 quarters'},
            {value: 'yearly', label: 'All-time'},
        ])
        expect(locals.canFilter).toBe(true)
    })

    test('dashboard honors an allowed period', () => {
        const res = makeRes()
        const req = { session: { user: { id: '1' } }, query: {period: 'quarterly'} }
        router.renderDashboard(req, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.period).toBe('quarterly')
        expect(locals.canFilter).toBe(true)
    })

    test('handleApi defaults invalid periods', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'messages' }, session: {}, query: {period: 'weekly'} },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.period).toBe('daily')
        expect(res.json).toHaveBeenCalled()
    })

    test('handleApi passes allowed periods through', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'messages' }, session: { user: { id: '1' } }, query: {period: 'yearly'} },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.period).toBe('yearly')
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

    test("another user's profile shows stats only, no history, with avatar for managers", async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce({ id: 5, name: 'Alice', discordId: '111' })
        db.getProfileStats.mockResolvedValueOnce({ total: 10, lastMonth: 4, lastDay: 1 })

        await router.renderPublicProfile({ params: { id: '5' }, session: { user: { isManager: true } } }, res, { client: true })

        expect(db.getUserMessages).not.toHaveBeenCalled() // history stays private
        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(false)
        expect(locals.history).toBeNull()
        expect(locals.displayName).toBe('Alice')
        expect(locals.avatarUrl).toBe('http://avatar/x.webp')
        expect(resolveAvatarUrl).toHaveBeenCalled()
    })

    test("another user's profile is forbidden for non-managers", async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce({ id: 5, name: 'Alice', discordId: '111' })

        await router.renderPublicProfile({ params: { id: '5' }, session: { user: { isManager: false } } }, res, { client: true })

        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.send).toHaveBeenCalledWith('Not permitted')
    })

    test('own profile via /profile/:id shows the private history', async () => {
        const res = makeRes()
        db.getUserById.mockResolvedValueOnce({ id: 5, name: 'Me', discordId: '111' })
        db.getUserMessages.mockResolvedValueOnce({
            totalCount: 20,
            lastMonthMessagesCount: 8,
            lastDayMessages: [{ content: 'leo', createdAt: 'now' }],
        })
        db.getProfileStats.mockResolvedValueOnce({
            total: 20,
            lastMonth: 8,
            lastDay: 1,
            allTimePosition: 1,
        })

        await router.renderPublicProfile(
            { params: { id: '5' }, session: { user: { id: '111', username: 'Me' } } },
            res
        )

        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(true)
        expect(locals.history).toHaveLength(1)
        expect(locals.stats.total).toBe(20)
        expect(locals.stats.allTimePosition).toBe(1)
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
        db.getProfileStats.mockResolvedValueOnce({
            total: 3,
            lastMonth: 2,
            lastDay: 1,
            allTimePosition: 1,
        })

        await router.renderProfile({ session: { user: { id: '111', username: 'Me', avatar: 'abc' } } }, res)

        const locals = res.render.mock.calls[0][1]
        expect(locals.isOwn).toBe(true)
        expect(locals.stats.lastDay).toBe(1)
        expect(locals.stats.allTimePosition).toBe(1)
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

    test('renderUsers renders paginated users and protects admins', async () => {
        const res = makeRes()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUsers.mockResolvedValueOnce({
            users: [
                { id: 1, discordId: '111', name: 'Admin', role: 'GOD', status: 'active' },
                { id: 2, discordId: '222', name: 'User', role: null, status: 'active' },
            ],
            totalCount: 51,
            stats: { roles: [], statuses: [] },
        })

        await router.renderUsers({
            session: { user: { id: '111', role: 'GOD', isManager: true } },
            query: { page: '2', role: 'STANDARD', status: 'bad' },
        }, res)

        const passedToDb = db.getUsers.mock.calls[0][0]
        expect(passedToDb.page).toBe(2)
        expect(passedToDb.role).toBe('STANDARD')
        expect(passedToDb.status).toBe('')

        const locals = res.render.mock.calls[0][1]
        expect(locals.totalPages).toBe(2)
        expect(locals.roleOptions.map(role => role.value)).toEqual([
            'GOD', 'VIP', 'SPECIAL', 'STANDARD', 'PRISONER',
        ])
        expect(locals.users[0].canEditMode).toBe(true)
        expect(locals.users[0].canEditRole).toBe(false)
        expect(locals.users[0].canEditStatus).toBe(false)
        expect(locals.users[1].canEditRole).toBe(true)
        expect(locals.users[1].roleLabel).toBe('Standard')
        expect(locals.showRoleInfo).toBe(true)
        expect(locals.roleInfoCards.map(card => card.role)).toEqual([
            'SPECIAL', 'STANDARD', 'PRISONER',
        ])
    })

    test('renderUsers shows current role info cards for admins', async () => {
        const res = makeRes()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUsers.mockResolvedValueOnce({
            users: [
                { id: 2, discordId: '222', name: 'User', role: null, status: 'active' },
            ],
            totalCount: 1,
        })
        redis.json.get.mockResolvedValueOnce({
            SPECIAL: {
                dailyCommandLimit: 0,
                hourlyCommandLimit: 0,
                dailyDeckScreenshotLimit: 30,
                attachmentLimit: 10,
            },
            STANDARD: {
                dailyCommandLimit: 100,
                hourlyCommandLimit: 20,
                dailyDeckScreenshotLimit: 10,
                attachmentLimit: 5,
            },
            PRISONER: {
                dailyCommandLimit: 5,
                hourlyCommandLimit: 5,
                dailyDeckScreenshotLimit: 1,
                attachmentLimit: 5,
            },
        })

        await router.renderUsers({
            session: { user: { id: '111', role: 'VIP', isManager: true } },
            query: {},
        }, res)

        const locals = res.render.mock.calls[0][1]
        expect(locals.showRoleInfo).toBe(true)
        expect(locals.roleInfoCards.map(card => card.role)).toEqual([
            'SPECIAL', 'STANDARD', 'PRISONER',
        ])
        expect(locals.roleInfoCards[1].stats[0]).toEqual({
            label: 'Daily commands',
            value: 100,
        })
    })

    test('renderUsers allows GOD to edit another admin role', async () => {
        const res = makeRes()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUsers.mockResolvedValueOnce({
            users: [
                { id: 2, discordId: '222', name: 'Admin', role: 'VIP', status: 'active' },
            ],
            totalCount: 1,
        })

        await router.renderUsers({
            session: { user: { id: '111', role: 'GOD', isManager: true } },
            query: {},
        }, res)

        const locals = res.render.mock.calls[0][1]
        expect(locals.users[0].canEditRole).toBe(true)
        expect(locals.users[0].assignableRoles.map(role => role.value)).toEqual([
            'GOD', 'VIP', 'SPECIAL', 'STANDARD', 'PRISONER',
        ])
    })

    test('handleUserUpdate blocks VIP editing another admin', async () => {
        const res = makeRes()
        res.redirect = jest.fn()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUserById.mockResolvedValueOnce({ id: 2, discordId: '222', role: 'VIP' })

        await router.handleUserUpdate({
            session: { user: { id: '111', role: 'VIP', isManager: true } },
            params: { id: '2' },
            body: { field: 'role', role: 'PRISONER', returnTo: '/users' },
        }, res)

        expect(db.updateUserAdminFields).not.toHaveBeenCalled()
        expect(res.redirect).toHaveBeenCalledWith('/users')
    })

    test('handleUserUpdate lets GOD assign any role', async () => {
        const res = makeRes()
        res.redirect = jest.fn()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUserById.mockResolvedValueOnce({ id: 2, discordId: '222', role: null })

        await router.handleUserUpdate({
            session: { user: { id: '111', role: 'GOD', isManager: true } },
            params: { id: '2' },
            body: { field: 'role', role: 'SPECIAL', returnTo: '/users' },
        }, res)

        expect(db.updateUserAdminFields).toHaveBeenCalledWith(2, { role: 'SPECIAL' })
    })

    test('handleUserUpdate limits VIP role assignment to Standard or Prisoner', async () => {
        const res = makeRes()
        res.redirect = jest.fn()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUserById.mockResolvedValueOnce({ id: 2, discordId: '222', role: null })

        await router.handleUserUpdate({
            session: { user: { id: '111', role: 'VIP', isManager: true } },
            params: { id: '2' },
            body: { field: 'role', role: 'PRISONER', returnTo: '/users' },
        }, res)

        expect(db.updateUserAdminFields).toHaveBeenCalledWith(2, { role: 'PRISONER' })

        jest.clearAllMocks()
        res.redirect = jest.fn()
        db.getUserById.mockResolvedValueOnce({ id: 2, discordId: '222', role: null })
        await router.handleUserUpdate({
            session: { user: { id: '111', role: 'VIP', isManager: true } },
            params: { id: '2' },
            body: { field: 'role', role: 'SPECIAL', returnTo: '/users' },
        }, res)

        expect(db.updateUserAdminFields).not.toHaveBeenCalled()
    })

    test('handleUserUpdate lets an admin edit own mode and invalidates cache', async () => {
        const res = makeRes()
        res.redirect = jest.fn()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUserById.mockResolvedValueOnce({ id: 1, discordId: '111', role: 'GOD' })

        await router.handleUserUpdate({
            session: { user: { id: '111', role: 'GOD', isManager: true } },
            params: { id: '1' },
            body: { field: 'mode', mode: 'maintenance', returnTo: '/users?page=1' },
        }, res)

        expect(db.updateUserAdminFields).toHaveBeenCalledWith(1, { mode: 'maintenance' })
        expect(require('../src/controller/redis').redis.del).toHaveBeenCalledWith('discord:test:user:111')
        expect(res.redirect).toHaveBeenCalledWith('/users?page=1')
    })

    test('handleUserStatusToggle flips non-admin status and invalidates cache', async () => {
        const res = makeRes()
        res.redirect = jest.fn()
        isManager.mockImplementation(user => user.role === 'GOD' || user.role === 'VIP')
        db.getUserById.mockResolvedValueOnce({ id: 2, discordId: '222', role: null, status: 'active' })

        await router.handleUserStatusToggle({
            session: { user: { id: '111', role: 'VIP', isManager: true } },
            params: { id: '2' },
            body: { returnTo: '/users?page=1' },
        }, res)

        expect(db.updateUserAdminFields).toHaveBeenCalledWith(2, { status: 'inactive' })
        expect(require('../src/controller/redis').redis.del).toHaveBeenCalledWith('discord:test:user:222')
        expect(res.redirect).toHaveBeenCalledWith('/users?page=1')
    })

    test('renderRoles loads editable role rules', async () => {
        const res = makeRes()
        await router.renderRoles({ session: { user: { id: '111', role: 'GOD' } } }, res)

        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('roles')
        expect(locals.roles.map(role => role.role)).toEqual(['SPECIAL', 'STANDARD', 'PRISONER'])
        expect(locals.roles[2].rules.dailyCommandLimit).toBe(5)
        expect(locals.roles[2].rules.dailyDeckScreenshotLimit).toBe(1)
    })

    test('handleRoleRulesUpdate is GOD-only and saves sanitized rules', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleRoleRulesUpdate({
            session: { user: { id: '111', role: 'GOD' } },
            body: {
                SPECIAL_dailyCommandLimit: '0',
                SPECIAL_hourlyCommandLimit: '0',
                SPECIAL_dailyDeckScreenshotLimit: '0',
                SPECIAL_attachmentLimit: '10',
                STANDARD_dailyCommandLimit: '100',
                STANDARD_hourlyCommandLimit: '20',
                STANDARD_dailyDeckScreenshotLimit: '5',
                STANDARD_attachmentLimit: '5',
                PRISONER_dailyCommandLimit: '5',
                PRISONER_hourlyCommandLimit: '5',
                PRISONER_dailyDeckScreenshotLimit: '1',
                PRISONER_attachmentLimit: '5',
            },
        }, res)

        expect(redis.json.set).toHaveBeenCalledWith('web:test:role-rules', '$', expect.objectContaining({
            PRISONER: expect.objectContaining({
                dailyCommandLimit: 5,
                dailyDeckScreenshotLimit: 1,
            }),
        }))
        expect(res.redirect).toHaveBeenCalledWith('/roles')
    })
})

describe('simple renders', () => {
    test('renderCards renders the cards view', async () => {
        const res = makeRes()
        await router.renderCards({ session: { user: { id: '1' } } }, res)
        expect(res.render.mock.calls[0][0]).toBe('cards')
    })

    test('renderTerms renders the terms view with an effective date', () => {
        const res = makeRes()
        router.renderTerms({ session: { user: { id: '1' } } }, res)
        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('terms')
        expect(locals.title).toBe('Terms of Service')
        expect(locals.effectiveDate).toEqual(expect.any(String))
    })

    test('renderPrivacy renders the privacy view without a session', () => {
        const res = makeRes()
        router.renderPrivacy({}, res)
        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('privacy')
        expect(locals.title).toBe('Privacy Policy')
        expect(locals.user).toBeNull()
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

    test('renderTopDeck renders public top deck ranking data', async () => {
        const res = makeRes()
        db.getTopDeckRanking.mockResolvedValueOnce([
            {
                id: 2,
                name: 'Player',
                score: 5,
                tdWins: 4,
                tdLoses: 2,
                tdDraws: 1,
                tdGames: 7,
                winRatio: '0.57',
            },
        ])

        await router.renderTopDeck({ session: {}, query: {} }, res)

        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('topdeck')
        expect(locals.ranking).toHaveLength(1)
        expect(locals.totals).toEqual({ wins: 4, loses: 2, draws: 1, games: 7 })
        expect(locals.chartData.topScores[0]).toEqual({
            name: 'Player',
            score: 5,
            wins: 4,
            loses: 2,
            draws: 1,
        })
        expect(locals.chartData.outcomes[0]).toEqual({ label: 'Wins', count: 4, percent: 57.1 })
        expect(redis.json.set).toHaveBeenCalledWith('web:test:page:topdeck', '$', expect.any(Object))
        expect(redis.expire).toHaveBeenCalledWith('web:test:page:topdeck', 300)
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300')
    })

    test('renderTopDeck uses cached page data', async () => {
        const res = makeRes()
        redis.json.get.mockResolvedValueOnce({
            ranking: [],
            totals: { wins: 0, loses: 0, draws: 0, games: 0 },
            chartData: { topScores: [], outcomes: [], activity: [] },
        })

        await router.renderTopDeck({ session: {}, query: {} }, res)

        expect(db.getTopDeckRanking).not.toHaveBeenCalled()
        expect(redis.json.set).not.toHaveBeenCalled()
        expect(res.render.mock.calls[0][1].ranking).toEqual([])
    })

    test('renderSystem renders Redis and memory statistics', async () => {
        const res = makeRes()
        redis.get.mockImplementation(async key => {
            if (key === 'web:test:system:memory:thresholdMb') return '256'
            if (key === 'web:test:system:memory:availableMb') return '640'
            if (key === 'web:test:system:redis:memory:availableMb') return '35'
            return null
        })

        await router.renderSystem({ session: { user: { id: '1', isManager: true } } }, res)

        const [view, locals] = res.render.mock.calls[0]
        expect(view).toBe('system')
        expect(locals.redisStats.cache).toEqual(expect.objectContaining({
            hits: 8,
            misses: 2,
            hitRatio: 80,
            missRatio: 20,
        }))
        expect(locals.redisStats.general.uptimeHuman).toBe('1h 40m')
        expect(locals.redisStats.memory.availableMb).toBe(35)
        expect(locals.redisStats.memory.availableHuman).toBe('35 MB')
        expect(locals.memory.thresholdMb).toBe(256)
        expect(locals.memory.availableMb).toBe(640)
        expect(locals.memory.availableHuman).toBe('640 MB')
        expect(locals.memory.peak24h).toEqual(expect.objectContaining({
            rss: expect.any(Number),
        }))
        expect(locals.memory.sampleLimit).toEqual(expect.any(Number))
        expect(locals.memory.sampleIntervalMinutes).toBe(10)
        expect(locals.memory.sampleSpan).toEqual(expect.objectContaining({
            human: expect.any(String),
            milliseconds: expect.any(Number),
        }))
        expect(locals.memory.jump).toEqual(expect.objectContaining({
            detected: expect.any(Boolean),
            thresholdMb: 64,
        }))
        expect(locals.memory.current).toEqual(expect.objectContaining({
            rss: expect.any(Number),
            heapUsed: expect.any(Number),
            heapTotal: expect.any(Number),
            arrayBuffers: expect.any(Number),
        }))
        expect(redis.set).toHaveBeenCalledWith(
            'web:test:system:memory:peak24h',
            expect.stringMatching(/"rss":\d+(\.\d+)?/))
        expect(redis.expire).toHaveBeenCalledWith('web:test:system:memory:peak24h', 24 * 60 * 60)
        expect(redis.json.set).toHaveBeenCalledWith('web:test:system:memory:samples', '$', expect.any(Array))
    })

    test('handleSystemSettingsUpdate saves the system memory settings', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSystemSettingsUpdate(
            {
                session: { user: { id: '1', role: 'GOD', isManager: true } },
                body: {
                    memoryThresholdMb: '768',
                    memoryAvailableMb: '900',
                    redisMemoryAvailableMb: '45',
                },
            },
            res
        )

        expect(redis.set).toHaveBeenCalledWith('web:test:system:memory:thresholdMb', '768')
        expect(redis.set).toHaveBeenCalledWith('web:test:system:memory:availableMb', '900')
        expect(redis.set).toHaveBeenCalledWith('web:test:system:redis:memory:availableMb', '45')
        expect(res.redirect).toHaveBeenCalledWith('/system')
    })

    test('handleSystemSettingsUpdate rejects VIP users', async () => {
        const res = makeRes()

        await router.handleSystemSettingsUpdate(
            { session: { user: { id: '1', role: 'VIP', isManager: true } }, body: { memoryThresholdMb: '768' } },
            res
        )

        expect(redis.set).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.send).toHaveBeenCalledWith('Not permitted')
    })
})

describe('system metrics', () => {
    test('available memory settings fall back to env defaults when Redis is empty', async () => {
        expect(await getNodeMemoryAvailableMb(redis)).toBe(562)
        expect(await getRedisMemoryAvailableMb(redis)).toBe(30)
    })

    test('detectMemoryJump reports sudden memory increases', () => {
        const result = detectMemoryJump([
            { timestamp: 'a', rss: 100, heapUsed: 50, heapTotal: 80, external: 4, arrayBuffers: 1 },
            { timestamp: 'b', rss: 170, heapUsed: 52, heapTotal: 150, external: 5, arrayBuffers: 1 },
        ], 64)

        expect(result.detected).toBe(true)
        expect(result.message).toContain('RSS +70 MB')
        expect(result.message).toContain('Heap total +70 MB')
    })

    test('detectMemoryJump ignores small memory changes', () => {
        const result = detectMemoryJump([
            { timestamp: 'a', rss: 100, heapUsed: 50 },
            { timestamp: 'b', rss: 120, heapUsed: 55 },
        ], 64)

        expect(result.detected).toBe(false)
        expect(result.changes).toEqual([])
    })

    test('getSampleTimeSpan formats the stored sample window', () => {
        const result = getSampleTimeSpan([
            { timestamp: '2026-06-15T10:00:00.000Z' },
            { timestamp: '2026-06-15T12:10:00.000Z' },
        ])

        expect(result).toEqual({
            milliseconds: 130 * 60 * 1000,
            human: '2h 10m',
        })
    })
})

describe('login / logout', () => {
    test('handleLogin stores the Discord user in a regenerated session', async () => {
        axios.get.mockResolvedValueOnce({ data: { id: '111', username: 'Me' } })
        db.getUser.mockResolvedValueOnce({ id: 5, discordId: '111', role: 'GOD' })
        isManager.mockReturnValueOnce(true)

        const session = {
            regenerate: jest.fn(cb => cb()),
            save: jest.fn(cb => cb()),
        }
        const res = makeRes()
        res.redirect = jest.fn()
        await router.handleLogin(
            { body: { tokenType: 'Bearer', accessToken: 'tok' }, session },
            res,
            jest.fn()
        )

        expect(session.user).toEqual({ id: '111', username: 'Me', role: 'GOD', isManager: true })
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

describe('systemMetrics peak memory', () => {
    const { recordPeakMemoryUsage, getPeakMemoryUsage, recordMemoryUsage } = require('../src/tools/systemMetrics')

    function makeRedis(initialValue = null) {
        let stored = initialValue
        return {
            get: jest.fn(async () => stored),
            set: jest.fn(async (key, value) => { stored = value }),
            expire: jest.fn(async () => 1),
        }
    }

    function makeRedisWithSamples(samples) {
        let peak = null
        return {
            get: jest.fn(async () => peak),
            set: jest.fn(async (key, value) => { peak = value }),
            expire: jest.fn(async () => 1),
            json: {
                get: jest.fn(async () => samples),
                set: jest.fn(async (key, path, value) => { samples = value }),
            },
        }
    }

    test('retains the stored peak when the current RSS is lower', async () => {
        const redisClient = makeRedis(JSON.stringify({ rss: 500, timestamp: '2026-06-18T00:00:00.000Z' }))

        const result = await recordPeakMemoryUsage(redisClient, { rss: 120, timestamp: '2026-06-19T00:00:00.000Z' })

        expect(result.rss).toBe(500)
        expect(redisClient.set).not.toHaveBeenCalled()
    })

    test('updates the stored peak when the current RSS is higher', async () => {
        const redisClient = makeRedis(JSON.stringify({ rss: 100, timestamp: '2026-06-18T00:00:00.000Z' }))

        const result = await recordPeakMemoryUsage(redisClient, { rss: 750, timestamp: '2026-06-19T00:00:00.000Z' })

        expect(result.rss).toBe(750)
        expect(redisClient.set).toHaveBeenCalledTimes(1)
        const stored = JSON.parse(redisClient.set.mock.calls[0][1])
        expect(stored).toEqual({ rss: 750, timestamp: '2026-06-19T00:00:00.000Z' })
    })

    test('reads back legacy bare-number peak values', async () => {
        const redisClient = makeRedis('480.5')

        const peak = await getPeakMemoryUsage(redisClient, { rss: 90, timestamp: '2026-06-19T00:00:00.000Z' })

        expect(peak.rss).toBe(480.5)
    })

    test('raises the peak to the highest persisted sample after a restart', async () => {
        // Samples retained across a restart still hold a high pre-restart value.
        const redisClient = makeRedisWithSamples([
            { rss: 420, timestamp: '2026-06-18T22:00:00.000Z' },
            { rss: 380, timestamp: '2026-06-18T23:00:00.000Z' },
        ])

        // The current (post-restart) RSS is low, but the peak must reflect the chart.
        await recordMemoryUsage(redisClient, { rss: 110, timestamp: '2026-06-19T00:00:00.000Z' })

        const peak = await getPeakMemoryUsage(redisClient, { rss: 110, timestamp: '2026-06-19T00:00:00.000Z' })
        expect(peak.rss).toBe(420)
        expect(peak.timestamp).toBe('2026-06-18T22:00:00.000Z')
    })
})
