const {cachePrefix} = require('../controller/redis')

// One running total plus a per-day counter. Daily counters carry the date in
// the key and self-expire, so "today" is always a fresh read with no reset
// bookkeeping. Atomic INCR keeps the counts correct even though screenshots
// now run concurrently through the queue.
const totalKey = cachePrefix + 'screenshot:total'
const dailyPrefix = cachePrefix + 'screenshot:daily:'
//keep a couple of days of daily counters around, then let them expire
const dailyTtl = 60 * 60 * 24 * 2

/**
 * Current day as YYYY-MM-DD (UTC) — matches the key written by increment().
 *
 * @returns {string}
 */
function today() {
    return new Date().toISOString().slice(0, 10)
}

/**
 * Record one captured screenshot in both the total and today's counter.
 *
 * @param redis
 * @returns {Promise<void>}
 */
async function incrementScreenshotCounters(redis) {
    const dailyKey = dailyPrefix + today()
    await Promise.all([
        redis.incr(totalKey),
        redis.incr(dailyKey),
    ])
    await redis.expire(dailyKey, dailyTtl)
}

/**
 * Read the total and today's screenshot counts for display.
 *
 * @param redis
 * @returns {Promise<{total: number, daily: number}>}
 */
async function getScreenshotCounters(redis) {
    const [total, daily] = await Promise.all([
        redis.get(totalKey),
        redis.get(dailyPrefix + today()),
    ])

    return {
        total: parseInt(total, 10) || 0,
        daily: parseInt(daily, 10) || 0,
    }
}

module.exports = {incrementScreenshotCounters, getScreenshotCounters}
