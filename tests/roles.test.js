jest.mock('../src/controller/redis', () => ({
    redis: {
        json: {
            get: jest.fn(async () => null),
            set: jest.fn(async () => 'OK'),
        },
    },
    cachePrefix: 'web:test:',
}))
jest.mock('../src/controller/messageCache', () => ({
    cacheKeyPrefix: 'discord:test:',
}))

const {checkRoleCommandLimit} = require('../src/tools/roles')

function makeRedisMock() {
    const values = new Map()
    const expirations = new Map()

    return {
        incr: jest.fn(async key => {
            const next = (values.get(key) || 0) + 1
            values.set(key, next)
            return next
        }),
        expire: jest.fn(async (key, seconds) => {
            expirations.set(key, seconds)
            return 1
        }),
        exists: jest.fn(async key => values.has(key) ? 1 : 0),
        set: jest.fn(async (key, value) => {
            values.set(key, value)
            return 'OK'
        }),
        ttl: jest.fn(async key => expirations.get(key) || -1),
    }
}

function makePrisonerCtx(redis) {
    return {
        redis,
        user: {
            id: 1,
            discordId: '111',
            role: 'PRISONER',
            language: 'en',
        },
        limit: 10,
    }
}

function makeStandardCtx(redis) {
    return {
        redis,
        user: {
            id: 2,
            discordId: '222',
            role: 'STANDARD',
            language: 'en',
        },
        limit: 10,
    }
}

describe('role command limits', () => {
    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(1781440000000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('Standard users do not create command limit counters', async () => {
        const redis = makeRedisMock()
        const ctx = makeStandardCtx(redis)

        const result = await checkRoleCommandLimit(ctx)

        expect(result.allowed).toBe(true)
        expect(result.message).toBeNull()
        expect(ctx.limit).toBe(5)
        expect(redis.incr).not.toHaveBeenCalled()
        expect(redis.expire).not.toHaveBeenCalled()
        expect(redis.exists).not.toHaveBeenCalled()
        expect(redis.set).not.toHaveBeenCalled()
        expect(redis.ttl).not.toHaveBeenCalled()
    })

    test('Prisoner warning cycle repeats after the daily window resets', async () => {
        const redis = makeRedisMock()
        const ctx = makePrisonerCtx(redis)

        const first = await checkRoleCommandLimit(ctx)
        expect(first.allowed).toBe(true)
        expect(first.message).toContain('Prisoner role is limited to 5 commands per day.')
        expect(first.message).toContain('<t:1781526400:R>')

        for (let i = 0; i < 4; i++) {
            const allowed = await checkRoleCommandLimit(ctx)
            expect(allowed.allowed).toBe(true)
            expect(allowed.message).toBeNull()
        }

        const limited = await checkRoleCommandLimit(ctx)
        expect(limited.allowed).toBe(false)
        expect(limited.silent).toBe(false)
        expect(limited.message).toContain('Daily command limit reached (5).')
        expect(limited.message).toContain('<t:1781526400:R>')

        const silent = await checkRoleCommandLimit(ctx)
        expect(silent.allowed).toBe(false)
        expect(silent.silent).toBe(true)
        expect(silent.message).toBeUndefined()

        const resetRedis = makeRedisMock()
        const afterReset = await checkRoleCommandLimit(makePrisonerCtx(resetRedis))
        expect(afterReset.allowed).toBe(true)
        expect(afterReset.message).toContain('Prisoner role is limited to 5 commands per day.')
    })

    test('Prisoner limit messages use the command language', async () => {
        const redis = makeRedisMock()
        const ctx = makePrisonerCtx(redis)
        ctx.language = 'de'

        const first = await checkRoleCommandLimit(ctx)
        expect(first.message).toContain('Die Rolle Prisoner ist auf 5 Befehle pro Tag begrenzt.')

        for (let i = 0; i < 4; i++) {
            await checkRoleCommandLimit(ctx)
        }

        const limited = await checkRoleCommandLimit(ctx)
        expect(limited.message).toContain('Tägliches Befehlslimit erreicht (5).')
    })
})
