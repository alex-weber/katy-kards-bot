// Unit tests for the web router handlers. All data/IO dependencies are mocked
// so no DB, Redis, Discord or network access is required.

jest.mock('../src/database/db', () => ({
    getAllSynonyms: jest.fn(async () => []),
    getSynonym: jest.fn(),
    createSynonym: jest.fn(async () => {}),
    updateSynonym: jest.fn(async () => {}),
    deleteSynonym: jest.fn(async () => {}),
    getUser: jest.fn(),
    getUserById: jest.fn(),
    getUsers: jest.fn(),
    getUserStatusCounts: jest.fn(async () => ({
        total: 0, active: 0, pending: 0, declined: 0, banned: 0, newToday: 0,
    })),
    createUserAudit: jest.fn(async () => {}),
    getRecentUserAudits: jest.fn(async () => []),
    getMessages: jest.fn(),
    getUserMessages: jest.fn(),
    getProfileStats: jest.fn(),
    updateUserAdminFields: jest.fn(),
    getTopDeckRanking: jest.fn(),
}))
jest.mock('../src/controller/synonymCache', () => ({
    invalidateSynonymCache: jest.fn(async () => {}),
}))
jest.mock('../src/tools/imageUpload', () => ({
    uploadImageFile: jest.fn(async () => 'https://img.example.com/uploaded.webp'),
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
jest.mock('../src/tools/syncRunner', () => ({
    startSync: jest.fn(() => ({ started: true })),
    getSyncState: jest.fn(async () => ({ running: false, startedAt: null, last: null })),
}))
jest.mock('../src/tools/search', () => ({
    isManager: jest.fn(() => false),
    checkSynonymKey: jest.fn(key => /^[\sa-z0-9_-]+$/.test(key)),
}))
jest.mock('axios', () => ({ get: jest.fn() }))

const path = require('path')
const db = require('../src/database/db')
const {getSynonym, createSynonym, updateSynonym, deleteSynonym} = db
const API = require('../src/controller/api')
const axios = require('axios')
const { isManager} = require('../src/tools/search')
const { resolveAvatarUrl } = require('../src/tools/avatar')
const { invalidateSynonymCache } = require('../src/controller/synonymCache')
const { uploadImageFile } = require('../src/tools/imageUpload')
const { startSync, getSyncState } = require('../src/tools/syncRunner')
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
    test('landing defaults to current month and exposes the allowed periods', () => {
        const res = makeRes()
        router.renderLanding({ session: {}, query: {period: 'weekly'} }, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.period).toBe('current-month')
        expect(locals.periods).toEqual([
            {value: 'current-month', label: 'Current month'},
            {value: 'last-month', label: 'Last month'},
            {value: 'last-year', label: 'Last year'},
            {value: 'all-time', label: 'All-time'},
        ])
        expect(locals.canFilter).toBe(true)
    })

    test('dashboard honors an allowed period', () => {
        const res = makeRes()
        const req = { session: { user: { id: '1' } }, query: {period: 'all-time'} }
        router.renderDashboard(req, res)
        const locals = res.render.mock.calls[0][1]
        expect(locals.period).toBe('all-time')
        expect(locals.canFilter).toBe(true)
    })

    test('handleApi defaults invalid periods', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'messages' }, session: {}, query: {period: 'weekly'} },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.period).toBe('current-month')
        expect(res.json).toHaveBeenCalled()
    })

    test('handleApi passes allowed periods through', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'messages' }, session: { user: { id: '1' } }, query: {period: 'all-time'} },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.period).toBe('all-time')
    })

    test('handleApi passes the daily counter series period through', async () => {
        const res = makeRes()
        await router.handleApi(
            { params: { method: 'messages' }, session: {}, query: {period: 'daily'} },
            res
        )
        const args = API.run.mock.calls[0][1]
        expect(args.period).toBe('daily')
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
        await router.renderCommands(
            { session: { user: { isManager: true } }, path: '/commands', query: {} }, res)
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

describe('synonym value helpers', () => {
    describe('buildSynonymValue', () => {
        test('stores a text reply with the "text:" prefix', () => {
            const value = router.buildSynonymValue({
                contentType: 'text', text: 'Roar!', redirectTarget: '', files: [],
            })
            expect(JSON.parse(value)).toEqual({content: 'text:Roar!'})
        })

        test('stores a redirect target without any prefix', () => {
            const value = router.buildSynonymValue({
                contentType: 'redirect', text: '', redirectTarget: 'lion for a day', files: [],
            })
            expect(JSON.parse(value)).toEqual({content: 'lion for a day'})
        })

        test('includes files alongside text', () => {
            const value = router.buildSynonymValue({
                contentType: 'text', text: 'hi', redirectTarget: '', files: ['http://x/img.png'],
            })
            expect(JSON.parse(value)).toEqual({content: 'text:hi', files: ['http://x/img.png']})
        })

        test('files alone (no text) is valid', () => {
            const value = router.buildSynonymValue({
                contentType: 'text', text: '', redirectTarget: '', files: ['http://x/img.png'],
            })
            expect(JSON.parse(value)).toEqual({files: ['http://x/img.png']})
        })

        test('returns null when there is nothing to store', () => {
            expect(router.buildSynonymValue({
                contentType: 'text', text: '  ', redirectTarget: '', files: [],
            })).toBeNull()
        })
    })

    describe('parseSynonymValue', () => {
        test('parses canonical JSON with a text reply', () => {
            expect(router.parseSynonymValue(JSON.stringify({content: 'text:Roar!'})))
                .toEqual({contentType: 'text', text: 'Roar!', redirectTarget: '', files: []})
        })

        test('parses canonical JSON with a redirect', () => {
            expect(router.parseSynonymValue(JSON.stringify({content: 'lion for a day'})))
                .toEqual({contentType: 'redirect', text: '', redirectTarget: 'lion for a day', files: []})
        })

        test('parses canonical JSON with files only', () => {
            expect(router.parseSynonymValue(JSON.stringify({files: ['http://x/img.png']})))
                .toEqual({contentType: 'text', text: '', redirectTarget: '', files: ['http://x/img.png']})
        })

        test('upgrades a legacy bare image URL', () => {
            expect(router.parseSynonymValue('http://x/img.png'))
                .toEqual({contentType: 'text', text: '', redirectTarget: '', files: ['http://x/img.png']})
        })

        test('upgrades a legacy bare "text:" string', () => {
            expect(router.parseSynonymValue('text:old style'))
                .toEqual({contentType: 'text', text: 'old style', redirectTarget: '', files: []})
        })

        test('treats a legacy bare redirect string as a redirect', () => {
            expect(router.parseSynonymValue('someothercommand'))
                .toEqual({contentType: 'redirect', text: '', redirectTarget: 'someothercommand', files: []})
        })

        test('round-trips through buildSynonymValue', () => {
            const built = router.buildSynonymValue({
                contentType: 'text', text: 'hello', redirectTarget: '', files: ['http://x/a.png'],
            })
            expect(router.parseSynonymValue(built)).toEqual({
                contentType: 'text', text: 'hello', redirectTarget: '', files: ['http://x/a.png'],
            })
        })
    })
})

describe('renderCommands', () => {
    function makeCommandsReq(query = {}) {
        return {session: {user: {isManager: true}}, path: '/commands', query}
    }

    async function renderWith(synonyms, query) {
        db.getAllSynonyms.mockResolvedValueOnce(synonyms)
        const res = makeRes()

        await router.renderCommands(makeCommandsReq(query), res)

        return res.render.mock.calls[0][1]
    }

    test('parses each synonym\'s value for the template', async () => {
        const locals = await renderWith([
            {id: 1, key: 'lion', value: JSON.stringify({content: 'text:Roar!'})},
        ])

        expect(locals.synonyms[0].parsed).toEqual({
            contentType: 'text', text: 'Roar!', redirectTarget: '', files: [],
        })
        expect(locals.synonyms[0].kind).toBe('text')
    })

    test('sorts by key and labels each command\'s kind', async () => {
        const locals = await renderWith([
            {id: 1, key: 'zebra', value: JSON.stringify({content: 'othercommand'})},
            {id: 2, key: 'meme', value: JSON.stringify({files: ['http://x/a.png']})},
            {id: 3, key: 'aardvark', value: JSON.stringify({content: 'text:hi'})},
        ])

        expect(locals.synonyms.map(synonym => [synonym.key, synonym.kind])).toEqual([
            ['aardvark', 'text'],
            ['meme', 'image'],
            ['zebra', 'redirect'],
        ])
    })

    test('searches keys, reply text and redirect targets', async () => {
        const all = [
            {id: 1, key: 'lion', value: JSON.stringify({content: 'lion for a day'})},
            {id: 2, key: 'roar', value: JSON.stringify({content: 'text:the lion roars'})},
            {id: 3, key: 'unrelated', value: JSON.stringify({content: 'text:nothing here'})},
        ]

        const locals = await renderWith(all, {q: 'LION'})

        expect(locals.synonyms.map(synonym => synonym.key)).toEqual(['lion', 'roar'])
        expect(locals.totalCount).toBe(2)
        expect(locals.allCount).toBe(3)
    })

    test('filters by kind and ignores an unknown type', async () => {
        const all = [
            {id: 1, key: 'alias', value: JSON.stringify({content: 'othercommand'})},
            {id: 2, key: 'reply', value: JSON.stringify({content: 'text:hi'})},
        ]

        expect((await renderWith(all, {type: 'redirect'})).synonyms.map(s => s.key))
            .toEqual(['alias'])
        expect((await renderWith(all, {type: 'bogus'})).synonyms).toHaveLength(2)
    })

    test('pages the filtered list and clamps an out-of-range page', async () => {
        const all = Array.from({length: 30}, (unused, index) => ({
            id: index,
            key: `cmd${String(index).padStart(2, '0')}`,
            value: JSON.stringify({content: 'text:hi'}),
        }))

        const first = await renderWith(all, {})
        expect(first.synonyms).toHaveLength(20)
        expect(first.totalPages).toBe(2)

        const clamped = await renderWith(all, {page: '99'})
        expect(clamped.page).toBe(2)
        expect(clamped.synonyms).toHaveLength(10)
        expect(clamped.synonyms[0].key).toBe('cmd20')
    })
})

describe('handleSynonymCreate', () => {
    function makeReq(body) {
        return {session: {user: {isManager: true}}, body}
    }

    test('rejects non-managers', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymCreate({session: {user: {isManager: false}}, body: {}}, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(createSynonym).not.toHaveBeenCalled()
    })

    test('creates a new synonym and invalidates its cache', async () => {
        getSynonym.mockResolvedValueOnce(null)
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymCreate(
            makeReq({key: 'lion', contentType: 'text', text: 'Roar!'}), res)

        expect(createSynonym).toHaveBeenCalledWith('lion', JSON.stringify({content: 'text:Roar!'}))
        expect(invalidateSynonymCache).toHaveBeenCalledWith('lion')
        expect(res.redirect).toHaveBeenCalledWith('/commands')
    })

    test('rejects an invalid key without touching the database', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymCreate(
            makeReq({key: 'bad key!', contentType: 'text', text: 'x'}), res)

        expect(createSynonym).not.toHaveBeenCalled()
        expect(res.redirect).toHaveBeenCalledWith('/commands')
    })

    test('refuses to overwrite an existing key (edit that row instead)', async () => {
        getSynonym.mockResolvedValueOnce({id: 1, key: 'lion', value: '{}'})
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymCreate(
            makeReq({key: 'lion', contentType: 'text', text: 'x'}), res)

        expect(createSynonym).not.toHaveBeenCalled()
    })

    test('does nothing when there is no content or files', async () => {
        getSynonym.mockResolvedValueOnce(null)
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymCreate(makeReq({key: 'lion', contentType: 'text', text: '  '}), res)

        expect(createSynonym).not.toHaveBeenCalled()
    })
})

describe('handleSynonymUpdate', () => {
    // A host the bot is actually allowed to fetch images from.
    const cdn = 'https://cdn.discordapp.com/attachments/1/2/'

    function makeReq(params, body) {
        return {session: {user: {isManager: true}}, params, body}
    }

    test('rejects non-managers', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymUpdate(
            {session: {user: {isManager: false}}, params: {key: 'lion'}, body: {}}, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(updateSynonym).not.toHaveBeenCalled()
    })

    test('updates an existing synonym and invalidates the cache when the value changed', async () => {
        getSynonym.mockResolvedValueOnce({id: 1, key: 'lion', value: JSON.stringify({content: 'text:old'})})
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymUpdate(
            makeReq({key: 'lion'}, {contentType: 'text', text: 'new'}), res)

        expect(updateSynonym).toHaveBeenCalledWith('lion', JSON.stringify({content: 'text:new'}))
        expect(invalidateSynonymCache).toHaveBeenCalledWith('lion')
    })

    test('keeps only the checked existing files, and appends newly uploaded ones', async () => {
        getSynonym.mockResolvedValueOnce({
            id: 1, key: 'lion',
            value: JSON.stringify({content: 'text:old', files: [cdn + 'a.png', cdn + 'b.png']}),
        })
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymUpdate(makeReq({key: 'lion'}, {
            contentType: 'text', text: 'new',
            keepFiles: cdn + 'a.png', // b.png was left unchecked
            files: cdn + 'c.png', // newly uploaded
        }), res)

        const [, storedValue] = updateSynonym.mock.calls[0]
        expect(JSON.parse(storedValue).files).toEqual([cdn + 'a.png', cdn + 'c.png'])
    })

    // The form is the one place an admin-supplied URL enters a stored command,
    // and every stored file is later fetched server-side (see imageUrl.js).
    test('drops a submitted file URL the bot would refuse to download', async () => {
        getSynonym.mockResolvedValueOnce({
            id: 1, key: 'lion', value: JSON.stringify({content: 'text:old', files: []}),
        })
        const res = makeRes()
        res.redirect = jest.fn()
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {})

        await router.handleSynonymUpdate(makeReq({key: 'lion'}, {
            contentType: 'text', text: 'new',
            files: ['http://169.254.169.254/latest/meta-data/', cdn + 'ok.png'],
        }), res)

        const [, storedValue] = updateSynonym.mock.calls[0]
        expect(JSON.parse(storedValue).files).toEqual([cdn + 'ok.png'])

        // The admin sees nothing when this happens — the log is the only trace,
        // and a missing IMAGE_ALLOWED_HOSTS is the usual reason.
        expect(logged).toHaveBeenCalledTimes(1)
        expect(logged.mock.calls[0].join(' ')).toContain('IMAGE_ALLOWED_HOSTS')
        expect(logged.mock.calls[0]).toContain('http://169.254.169.254/latest/meta-data/')
        logged.mockRestore()
    })

    test('does nothing for an unknown key', async () => {
        getSynonym.mockResolvedValueOnce(null)
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymUpdate(makeReq({key: 'ghost'}, {contentType: 'text', text: 'x'}), res)

        expect(updateSynonym).not.toHaveBeenCalled()
    })

    test('skips the cache invalidation when nothing actually changed', async () => {
        getSynonym.mockResolvedValueOnce({id: 1, key: 'lion', value: JSON.stringify({content: 'text:same'})})
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymUpdate(makeReq({key: 'lion'}, {contentType: 'text', text: 'same'}), res)

        expect(updateSynonym).toHaveBeenCalled()
        expect(invalidateSynonymCache).not.toHaveBeenCalled()
    })
})

describe('handleSynonymDelete', () => {
    test('rejects non-managers', async () => {
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymDelete(
            {session: {user: {isManager: false}}, params: {key: 'lion'}}, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(deleteSynonym).not.toHaveBeenCalled()
    })

    test('deletes an existing synonym and invalidates its cache', async () => {
        getSynonym.mockResolvedValueOnce({id: 1, key: 'lion', value: '{}'})
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymDelete(
            {session: {user: {isManager: true}}, params: {key: 'lion'}}, res)

        expect(deleteSynonym).toHaveBeenCalledWith('lion')
        expect(invalidateSynonymCache).toHaveBeenCalledWith('lion')
        expect(res.redirect).toHaveBeenCalledWith('/commands')
    })

    test('does nothing for an unknown key (still redirects)', async () => {
        getSynonym.mockResolvedValueOnce(null)
        const res = makeRes()
        res.redirect = jest.fn()

        await router.handleSynonymDelete(
            {session: {user: {isManager: true}}, params: {key: 'ghost'}}, res)

        expect(deleteSynonym).not.toHaveBeenCalled()
        expect(res.redirect).toHaveBeenCalledWith('/commands')
    })
})

describe('the sync endpoints', () => {
    const manager = { session: { user: { isManager: true, username: 'Katy' } } }

    test('handleSyncStart rejects non-managers', async () => {
        const res = makeRes()

        await router.handleSyncStart({ session: { user: { isManager: false } } }, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(startSync).not.toHaveBeenCalled()
    })

    test('handleSyncStatus rejects non-managers', async () => {
        const res = makeRes()

        await router.handleSyncStatus({ session: { user: { isManager: false } } }, res)

        expect(res.status).toHaveBeenCalledWith(403)
    })

    test('handleSyncStart kicks off a sync and returns the new state', async () => {
        getSyncState.mockResolvedValueOnce(
            { running: true, startedAt: '2026-07-25T09:13:00Z', progress: '40 / 900 cards checked', last: null })
        const res = makeRes()

        await router.handleSyncStart(manager, res)

        expect(startSync).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: 'Katy' }))
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            running: true,
            startedAt: '2026-07-25T09:13:00Z',
            kicker: 'in progress',
            status: '40 / 900 cards checked',
        }))
    })

    test('handleSyncStart answers 409 when a sync is already running', async () => {
        startSync.mockReturnValueOnce({ started: false, reason: 'A sync is already running' })
        const res = makeRes()

        await router.handleSyncStart(manager, res)

        expect(res.status).toHaveBeenCalledWith(409)
        expect(res.json).toHaveBeenCalledWith({ error: 'A sync is already running' })
    })

    // The poll loop gets the display strings ready-made, so the widget never
    // formats a duration or an outcome the server-rendered page formats too.
    test('handleSyncStatus returns the current state, ready to print', async () => {
        getSyncState.mockResolvedValueOnce({
            running: false,
            startedAt: null,
            last: { finishedAt: '2026-07-25T09:14:00Z', ok: true, created: 1, updated: 2,
                totalCards: 917, seconds: 2.5, triggeredBy: 'Katy' },
            history: [{ finishedAt: '2026-07-24T08:00:00Z', ok: false, seconds: 0.4,
                triggeredBy: 'Tim', error: 'kards.com returned no cards' }],
        })
        const res = makeRes()

        await router.handleSyncStatus(manager, res)

        const view = res.json.mock.calls[0][0]
        expect(view).toMatchObject({
            running: false,
            kicker: 'last run by Katy',
            status: '917 cards checked',
            last: { duration: '2.5s', outcome: '1 created, 2 updated' },
        })
        expect(view.history[0]).toMatchObject({
            duration: '0.4s',
            outcome: 'Failed: kards.com returned no cards',
        })
    })
})

describe('handleSynonymImageUpload', () => {
    // Where the handler re-anchors every temp file (see synonymUploadDir).
    const uploadDir = path.join(__dirname, '../src/tmp/downloads')

    // Stands in for a deployment's configured image host: the endpoint only
    // hands back a URL the bot would later be allowed to fetch.
    const originalHosts = process.env.IMAGE_ALLOWED_HOSTS
    beforeEach(() => { process.env.IMAGE_ALLOWED_HOSTS = 'img.example.com' })
    afterEach(() => { process.env.IMAGE_ALLOWED_HOSTS = originalHosts })

    test('rejects non-managers', async () => {
        const res = makeRes()

        await router.handleSynonymImageUpload({session: {user: {isManager: false}}}, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(uploadImageFile).not.toHaveBeenCalled()
    })

    test('rejects when no file was received', async () => {
        const res = makeRes()

        await router.handleSynonymImageUpload({session: {user: {isManager: true}}, file: undefined}, res)

        expect(res.status).toHaveBeenCalledWith(400)
    })

    test('uploads the file and returns its URL', async () => {
        uploadImageFile.mockResolvedValueOnce('https://img.example.com/x.webp')
        const res = makeRes()

        await router.handleSynonymImageUpload({
            session: {user: {isManager: true}}, file: {path: '/tmp/fake-upload.png'},
        }, res)

        expect(uploadImageFile).toHaveBeenCalledWith(path.join(uploadDir, 'fake-upload.png'))
        expect(res.json).toHaveBeenCalledWith({url: 'https://img.example.com/x.webp'})
    })

    test('confines the file to the upload dir, whatever path it arrives with', async () => {
        uploadImageFile.mockResolvedValueOnce('https://img.example.com/x.webp')
        const res = makeRes()

        await router.handleSynonymImageUpload({
            session: {user: {isManager: true}}, file: {path: '/etc/passwd'},
        }, res)

        expect(uploadImageFile).toHaveBeenCalledWith(path.join(uploadDir, 'passwd'))
    })

    test('reports failure when the upload itself fails', async () => {
        uploadImageFile.mockResolvedValueOnce(false)
        const res = makeRes()

        await router.handleSynonymImageUpload({
            session: {user: {isManager: true}}, file: {path: '/tmp/fake-upload.png'},
        }, res)

        expect(res.status).toHaveBeenCalledWith(502)
    })

    // Otherwise the admin sees a thumbnail, saves, and gets a command with no
    // image and no explanation — the upload succeeded, the delivery cannot.
    test('refuses a URL the bot would not be allowed to fetch back', async () => {
        uploadImageFile.mockResolvedValueOnce('https://somewhere-else.example/x.webp')
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {})
        const res = makeRes()

        await router.handleSynonymImageUpload({
            session: {user: {isManager: true}}, file: {path: '/tmp/fake-upload.png'},
        }, res)

        expect(res.status).toHaveBeenCalledWith(502)
        expect(res.json).toHaveBeenCalledWith({error: expect.stringContaining('IMAGE_ALLOWED_HOSTS')})
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })

    // What is stored is then exactly what the bot will ask for later.
    test('returns the normalized URL', async () => {
        uploadImageFile.mockResolvedValueOnce('http://img.example.com/x.webp')
        const res = makeRes()

        await router.handleSynonymImageUpload({
            session: {user: {isManager: true}}, file: {path: '/tmp/fake-upload.png'},
        }, res)

        expect(res.json).toHaveBeenCalledWith({url: 'https://img.example.com/x.webp'})
    })
})
