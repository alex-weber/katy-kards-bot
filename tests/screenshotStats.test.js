// Tests for the screenshot counter helpers (src/tools/screenshotStats.js).

jest.mock('../src/controller/redis', () => ({ cachePrefix: 'test:' }))

const {
    incrementScreenshotCounters,
    getScreenshotCounters,
} = require('../src/tools/screenshotStats')

function makeRedis(store = new Map()) {
    return {
        store,
        incr: jest.fn(async key => {
            const next = (store.get(key) || 0) + 1
            store.set(key, next)
            return next
        }),
        get: jest.fn(async key => (store.has(key) ? String(store.get(key)) : null)),
        expire: jest.fn(async () => {}),
    }
}

describe('screenshotStats', () => {
    test('increment bumps both the total and today\'s counter', async () => {
        const redis = makeRedis()
        await incrementScreenshotCounters(redis)
        await incrementScreenshotCounters(redis)

        const counters = await getScreenshotCounters(redis)
        expect(counters).toEqual({ total: 2, daily: 2, last30d: 2 })
    })

    test('daily counter is namespaced by date and given a TTL', async () => {
        const redis = makeRedis()
        const today = new Date().toISOString().slice(0, 10)
        await incrementScreenshotCounters(redis)

        const dailyKey = 'test:screenshot:daily:' + today
        expect(redis.incr).toHaveBeenCalledWith('test:screenshot:total')
        expect(redis.incr).toHaveBeenCalledWith(dailyKey)
        expect(redis.expire).toHaveBeenCalledWith(dailyKey, 60 * 60 * 24 * 31)
    })

    test('missing keys read back as zero', async () => {
        const redis = makeRedis()
        const counters = await getScreenshotCounters(redis)
        expect(counters).toEqual({ total: 0, daily: 0, last30d: 0 })
    })
})
