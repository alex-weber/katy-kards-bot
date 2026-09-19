const {redis, cachePrefix} = require('./redis')
const {FACTIONS} = require('../tools/factions')

// Card data only changes when a DB sync lands, and a sync that changes cards
// clears these keys — so the TTL is just a backstop.
const CARD_STATS_TTL = 60 * 60 * 24 * 30
// Bump when the shape of a cached card stats payload changes.
const CARD_STATS_CACHE_VERSION = 'v3'
// cards-by-faction used to be cached without expiry under the generic API key.
const legacyCardsByFactionKey = cachePrefix + 'api:v3:cards-by-faction:'

/**
 * @param method the API method, e.g. 'cards-by-faction' or 'card-stats'
 * @param faction
 * @returns {string}
 */
function cardStatsCacheKey(method, faction = '') {
    return `${cachePrefix}api:cards:${CARD_STATS_CACHE_VERSION}:${method}:${faction}`
}

/**
 * Drop every cached card stats payload, so the next page load recomputes them.
 *
 * @param redisClient
 * @returns {Promise<void>}
 */
async function clearCardStatsCache(redisClient = redis) {
    if (!redisClient?.del) return

    const keys = [
        legacyCardsByFactionKey,
        cardStatsCacheKey('cards-by-faction'),
        ...FACTIONS.map(faction => cardStatsCacheKey('card-stats', faction)),
    ]

    try {
        await redisClient.del(keys)
    } catch (e) {
        console.error('Error clearing card stats cache:', e)
    }
}

module.exports = {
    CARD_STATS_TTL,
    cardStatsCacheKey,
    clearCardStatsCache,
}
