const {redis, cachePrefix} = require("./redis")
const {cacheKeyPrefix} = require("./messageCache")

const thirtyDays = 60 * 60 * 24 * 30
const configuredSynonymExp = parseInt(process.env.REDIS_EXP_SYNONYM, 10)
const synonymCacheExp = Number.isFinite(configuredSynonymExp)
    ? configuredSynonymExp
    : thirtyDays

/**
 * Expire cached custom-command answers and the web command list for a synonym.
 *
 * @param key
 * @returns {Promise<void>}
 */
async function invalidateSynonymCache(key)
{
    if (typeof key !== 'string' || !key.length) return

    try {
        const keys = [cachePrefix + 'page:commands']
        const pattern = cacheKeyPrefix + '*:syn:' + key

        for await (const batch of redis.scanIterator({
            MATCH: pattern,
            COUNT: 100,
        })) {
            keys.push(...batch)
        }

        await redis.del(keys)
    } catch (e) {
        console.error('Error invalidating synonym cache:', e)
    }
}

module.exports = {
    synonymCacheExp,
    invalidateSynonymCache,
}
