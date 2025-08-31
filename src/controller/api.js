const {getCardsByFaction} = require('../database/card')
const {
    getLastMonthMessages,
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
} = require("../database/message")

const {redis, cachePrefix} = require('../controller/redis')

const expiration = parseInt(process.env.CACHE_API_EXPIRE) || 60*5

async function run(method)
{
    const response = {
        result: 200,
        success: false,
        message: `${method} ok!`,
        data: []
    }
    const cacheKey = cachePrefix + 'api:' +method
    const cached = await redis.json.get(cacheKey, '$')
    switch (method) {
        case 'cards-by-faction':
            if (!cached) {
                response.data = await getCardsByFaction()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, 60*60*24)
            }
            else response.data = cached
            response.success = true
            break
        case 'messages':
            if (!cached) {
                response.data = await getLastMonthMessages()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            }
            else response.data = cached
            response.success = true
            break
        case 'td-messages':
            if (!cached) {
                response.data = await getTopDeckMessages()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            }
            else response.data = cached
            response.success = true
            break
        case 'top-messages':
            if (!cached) {
                response.data = await getTopMessages()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey, expiration)
            }
            else response.data = cached
            response.success = true
            break
        case 'top-users':
            if (!cached) {
                response.data = await getTopUsers()
                await redis.json.set(cacheKey, '$', response.data)
                await redis.expire(cacheKey,  expiration)
            }
            else response.data = cached
            response.success = true
            break

        default:
            response.result = 404
            response.message = `${method} not found!`
    }

    return response
}

module.exports = {run}