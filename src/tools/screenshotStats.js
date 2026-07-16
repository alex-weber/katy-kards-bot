const {cachePrefix} = require('../controller/redis')

// One running total plus a per-day counter. Daily counters carry the date in
// the key and self-expire, so "today" is always a fresh read with no reset
// bookkeeping. Atomic INCR keeps the counts correct even though screenshots
// now run concurrently through the queue.
const totalKey = cachePrefix + 'screenshot:total'
const dailyPrefix = cachePrefix + 'screenshot:daily:'
//keep a month of daily counters around, then let them expire
const dailyTtl = 60 * 60 * 24 * 31

/**
 * Current day as YYYY-MM-DD (UTC) — matches the key written by increment().
 *
 * @returns {string}
 */
function today() {
    return new Date().toISOString().slice(0, 10)
}

/**
 * YYYY-MM-DD (UTC) for a given number of days ago.
 *
 * @param {number} daysAgo
 * @returns {string}
 */
function day(daysAgo) {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
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
    const todayStr = today()
    const keys = [totalKey, dailyPrefix + todayStr]
    for (let i = 1; i < 30; i++) {
        keys.push(dailyPrefix + day(i))
    }
    const results = await Promise.all(keys.map(key => redis.get(key)))
    const total = parseInt(results[0], 10) || 0
    const daily = parseInt(results[1], 10) || 0
    const last30d = results.slice(1).reduce((sum, val) => sum + (parseInt(val, 10) || 0), 0)

    return {
        total,
        daily,
        last30d,
    }
}

module.exports = {incrementScreenshotCounters, getScreenshotCounters}
