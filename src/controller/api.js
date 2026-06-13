const {getCardsByFaction} = require('../database/card')
const {
    getDashboardMessages,
    getScreenshotMessages,
    getTopMessages,
    getTopUsers,
} = require("../database/message")

const {redis, cachePrefix} = require('../controller/redis')

const expiration = parseInt(process.env.CACHE_API_EXPIRE) || 60*10
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

    if (statsMethods.has(method) && period && !STATS_PERIODS.includes(period)) {
        response.result = 400
        response.message = `Invalid period. Allowed periods: ${STATS_PERIODS.join(', ')}`
        return response
    }

    const statsPeriod = normalizeStatsPeriod(period)

    // Build cache key including all relevant params
    const paramKey = statsMethods.has(method) ? statsPeriod : ''
    const cacheKey = cachePrefix + 'api:' + method + ':' + paramKey

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

        default:
            response.result = 404
            response.message = `${method} not found!`
    }

    return response
}

module.exports = {run}
