const {getCardsByFaction} = require('../database/card')
const {
    getDashboardMessages,
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
} = require("../database/message")

const {redis, cachePrefix} = require('../controller/redis')

const expiration = parseInt(process.env.CACHE_API_EXPIRE) || 60*5

async function run(
    method,
    { from, to} = {}
)
{
    const response = {
        result: 200,
        success: false,
        message: `${method} ok!`,
        data: []
    }

    // Build cache key including all relevant params
    const paramKey = [
        from || '',
        to || '',
    ].join('_')
    const cacheKey = cachePrefix + 'api:' + method + ':' + paramKey

    const cached = await redis.json.get(cacheKey, '$')

    switch (method) {
        case 'cards-by-faction':
            if (!cached) {
                response.data = await getCardsByFaction()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, 60 * 60 * 24)
            } else response.data = cached
            response.success = true
            break

        case 'messages':
            if (!cached) {
                response.data = await getDashboardMessages({
                    from,
                    to,
                })
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            } else response.data = cached
            response.success = true
            break

        case 'td-messages':
            if (!cached) {
                response.data = await getTopDeckMessages({ from, to})
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            } else response.data = cached
            response.success = true
            break

        case 'top-messages':
            if (!cached) {
                response.data = await getTopMessages({ from, to })
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            } else response.data = cached
            response.success = true
            break

        case 'top-users':
            if (!cached) {
                response.data = await getTopUsers({ from, to })
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
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