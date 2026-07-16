const {getCardsByFaction} = require('../database/card')
const {
    getDashboardMessages,
    getScreenshotMessages,
    getTopMessages,
    getTopUsers,
    getTotalMessageCount,
    getTotalScreenshotCommandCount,
} = require("../database/message")

const {redis, cachePrefix} = require('../controller/redis')
const {getScreenshotCounters} = require('../tools/screenshotStats')

const expiration = parseInt(process.env.CACHE_API_EXPIRE) || 60*10
// Bump when the shape of any cached API response changes, so stale payloads
// from a previous deploy are abandoned instead of served verbatim.
const CACHE_VERSION = 'v2'
const STATS_PERIODS = ['yearly', 'quarterly', 'monthly', 'daily']

const statsMethods = new Set([
    'messages',
    'screenshot-messages',
    'top-messages',
    'top-users',
])

function normalizeStatsPeriod(period) {
    return STATS_PERIODS.includes(period) ? period : 'daily'
}

async function run(method, { period } = {}) {
    const response = {
        result: 200,
        success: false,
        message: `${method} ok!`,
        data: []
    }

    // Live counters: cheap atomic reads, served straight through without the
    // json cache so the widget always reflects the current totals.
    if (method === 'screenshot-counters') {
        response.data = await getScreenshotCounters(redis)
        response.success = true
        return response
    }

    if (statsMethods.has(method) && period && !STATS_PERIODS.includes(period)) {
        response.result = 400
        response.message = `Invalid period. Allowed periods: ${STATS_PERIODS.join(', ')}`
        return response
    }

    const statsPeriod = normalizeStatsPeriod(period)

    // Build cache key including all relevant params
    const paramKey = statsMethods.has(method) ? statsPeriod : ''
    const cacheKey = cachePrefix + 'api:' + CACHE_VERSION + ':' + method + ':' + paramKey

    const cached = await redis.json.get(cacheKey, '$')

    async function saveToCache(data, ttl = expiration) {
        await redis.json.set(cacheKey, '$', data)
        if (ttl) await redis.expire(cacheKey, ttl)
    }

    switch (method) {
        case 'cards-by-faction':
            if (!cached) {
                response.data = await getCardsByFaction()
                await saveToCache(response.data, 0)
            } else response.data = cached
            response.success = true
            break

        case 'messages':
            if (!cached) {
                response.data = await getDashboardMessages({period: statsPeriod})
                await saveToCache(response.data)
            } else response.data = cached

            response.success = true
            break

        case 'screenshot-messages':
            if (!cached) {
                response.data = await getScreenshotMessages({period: statsPeriod})
                await saveToCache(response.data)
            } else response.data = cached
            response.success = true
            break

        case 'top-messages':
            if (!cached) {
                response.data = await getTopMessages({period: statsPeriod})
                await saveToCache(response.data)
            } else response.data = cached
            response.success = true
            break

        case 'top-users':
            if (!cached) {
                response.data = await getTopUsers({period: statsPeriod})
                await saveToCache(response.data)
            } else response.data = cached
            response.success = true
            break

        case 'total-message-count':
            response.data = await getTotalMessageCount()
            response.success = true
            break

        case 'total-screenshot-command-count':
            response.data = await getTotalScreenshotCommandCount()
            response.success = true
            break

        default:
            response.result = 404
            response.message = `${method} not found!`
    }

    return response
}

module.exports = {run}
