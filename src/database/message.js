const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
//profile stats cache lifetime (seconds)
const profileExpiration = parseInt(process.env.REDIS_EXP_PROFILE) || 60 * 5
//historical stats (everything up to yesterday) are immutable; cache them
//for a full day. Correctness is guaranteed by the date baked into the cache
//key, so this TTL only bounds memory usage.
const historicalExpiration = parseInt(process.env.CACHE_HISTORICAL_EXPIRE) || 60 * 60 * 24
const {languages} = require('../tools/language')
/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createMessage(data)
{
    return await prisma.message.create({
        data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param userId
 * @returns {Promise<array>}
 */
async function getUserMessages(userId)
{
    const cacheKey = cachePrefix + 'page:profile:' + userId
    const cachedMessages = await redis.json.get(cacheKey, '$')
    if (cachedMessages) return cachedMessages

    const messages = {}
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    let lastDayMessages = await prisma.message.findMany({

        where: {
            authorId: userId,
            createdAt: {
                gte: dayAgo,
            },
        },
        orderBy: {
            createdAt: 'desc'
        },
    }).
    catch((e) => { throw e })

    messages.lastDayMessages =  lastDayMessages.map(message => ({
        ...message,
        timestamp: message.createdAt,
        createdAt: formatDate(new Date(message.createdAt))
    }))

    messages.totalCount = await prisma.message.count({
        where: {
            authorId: userId,
        }
    }).
    catch((e) => { throw e })

    const monthAgo = new Date(new Date() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    messages.lastMonthMessagesCount = await prisma.message.count({
        where: {
            authorId: userId,
            createdAt: {
                gte: monthAgo,
            },
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    await redis.json.set(cacheKey, '$', messages)
    await redis.expire(cacheKey, expiration)

    return messages

}

/**
 * Lightweight per-user command counts for the profile overview, cached in
 * Redis. Only the three counts are queried and stored (no message rows), so
 * both the DB work and the cached payload stay small.
 *
 * @param userId User table primary key
 * @returns {Promise<{total: number, lastMonth: number, lastDay: number}>}
 */
async function getProfileStats(userId)
{
    const cacheKey = cachePrefix + 'profile:stats:' + userId
    const cached = await redis.json.get(cacheKey, '$')
    if (cached) return cached

    const now = Date.now()
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)

    const [total, lastMonth, lastDay] = await Promise.all([
        prisma.message.count({where: {authorId: userId}}),
        prisma.message.count({
            where: {authorId: userId, createdAt: {gte: monthAgo}},
        }),
        prisma.message.count({
            where: {authorId: userId, createdAt: {gte: dayAgo}},
        }),
    ]).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    const stats = {total, lastMonth, lastDay}
    await redis.json.set(cacheKey, '$', stats)
    await redis.expire(cacheKey, profileExpiration)

    return stats
}

async function getMessages({ from, to, page = 1, pageSize = 50, username, command } = {})
{

    const p = Math.max(1, parseInt(page, 10) || 1)
    const size = Math.max(1, parseInt(pageSize, 10) || 50)
    const { fromDate, toDate } = getDates(from, to)
    const fromString = fromDate.toISOString().split('T')[0]
    const toString = toDate.toISOString().split('T')[0]
    const cacheKey =
        cachePrefix +
        `page:messages:${fromString}_${toString}_${p}_${size}_${username}_${command}`

    const cachedMessages = await redis.json.get(cacheKey, '$')
    if (cachedMessages) return cachedMessages

    // Base where clause (date range only)
    const where = {
        createdAt: {
            gte: fromDate,
            lte: toDate
        }
    }

    // Add user filter if provided
    if (username) {
        where.author = {
            name: {
                contains: username,
                mode: 'insensitive'
            }
        }
    }

    // Add message filter if provided
    if (command) {
        where.content = {
            contains: command,
            mode: 'insensitive'
        }
    }

    // Run count and query in parallel
    const [totalCount, messages] = await Promise.all([
        prisma.message.count({ where }),
        prisma.message.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (p - 1) * size,
            take: size,
            include: {
                author: {
                    select: { name: true }
                }
            }
        })
    ])

    const mappedMessages = messages.map(m => ({
        ...m,
        createdAt: formatDate(new Date(m.createdAt), true)
    }))

    const result = {
        messages: mappedMessages,
        totalCount,
        page: p,
        pageSize: size,
        username,
        command
    }

    await redis.json.set(cacheKey, '$', result)
    await redis.expire(cacheKey, expiration)

    return result
}

/**
 * Read the raw per-day message counts for a date range. This is the heavy
 * DB read (it scans every matching row's createdAt), so callers cache the
 * historical (≤ yesterday) slice for a full day via getDailyCountsCached.
 *
 * @param extraWhere extra Prisma `where` clause merged with the date range
 * @param fromDate range start (Date)
 * @param toDate range end (Date)
 * @returns {Promise<Object>} map of 'YYYY-MM-DD' -> count
 */
async function getDailyCounts(extraWhere, fromDate, toDate)
{
    const messages = await prisma.message.findMany({
        where: {
            createdAt: { gte: fromDate, lte: toDate },
            ...extraWhere,
        },
        select: { createdAt: true },
    })

    const counts = {}
    for (const m of messages) {
        const key = m.createdAt.toISOString().split('T')[0]
        counts[key] = (counts[key] || 0) + 1
    }
    return counts
}

/**
 * Split a [from, to] range into an immutable historical slice (everything up
 * to yesterday) and a flag for whether today is included. Lexical comparison
 * is safe for the 'YYYY-MM-DD' format.
 *
 * @returns {{today: string, histEnd: string, includeToday: boolean}}
 */
function splitRange(from, to)
{
    const today = daysAgoString(0)
    const yesterday = daysAgoString(1)
    return {
        today,
        histEnd: to < yesterday ? to : yesterday, // min(to, yesterday)
        includeToday: to >= today,
    }
}

/**
 * Return the JSON value cached at `cacheKey`, or compute it with `computeFn`,
 * store it with the given `ttl`, and return it.
 */
async function getOrCompute(cacheKey, ttl, computeFn)
{
    let cached = await redis.json.get(cacheKey, '$')
    if (!cached) {
        cached = await computeFn()
        await redis.json.set(cacheKey, '$', cached)
        await redis.expire(cacheKey, ttl)
    }
    return cached
}

/**
 * Daily counts for [from, to] with the "historical + today" caching pattern:
 * the immutable slice up to yesterday is cached for a day, while today's tiny
 * slice is recomputed on the page cycle and merged. The returned daily map is
 * cheap to re-bucket on every request, keeping results exact.
 *
 * @param keyBase cache namespace (e.g. 'messages', 'screenshot')
 * @param extraWhere extra Prisma `where` clause for getDailyCounts
 * @param from range start 'YYYY-MM-DD'
 * @param to range end 'YYYY-MM-DD'
 * @returns {Promise<Object>} merged map of 'YYYY-MM-DD' -> count
 */
async function getDailyCountsCached(keyBase, extraWhere, from, to)
{
    const { today, histEnd, includeToday } = splitRange(from, to)
    const dailyMap = {}

    // Historical slice [from, histEnd] — immutable, cached for a day.
    if (from <= histEnd) {
        const histKey = cachePrefix + `stats:daily:${keyBase}:${from}_${histEnd}`
        const hist = await getOrCompute(histKey, historicalExpiration, () => {
            const { fromDate, toDate } = getDates(from, histEnd)
            return getDailyCounts(extraWhere, fromDate, toDate)
        })
        Object.assign(dailyMap, hist)
    }

    // Today's slice — only when the requested range reaches today. Cached on
    // the short page cycle and merged into the historical counts.
    if (includeToday) {
        const todayKey = cachePrefix + `stats:daily:${keyBase}:today:${today}`
        const todayMap = await getOrCompute(todayKey, expiration, () => {
            const { fromDate, toDate } = getDates(today, today)
            return getDailyCounts(extraWhere, fromDate, toDate)
        })
        for (const [day, count] of Object.entries(todayMap)) {
            dailyMap[day] = (dailyMap[day] || 0) + count
        }
    }

    return dailyMap
}

/**
 * Turn a daily count map into chart buckets. Granularity (daily/weekly/
 * monthly) is chosen from the span of actual data, matching the previous
 * row-scanning behaviour but operating on the compact daily map.
 *
 * @param dailyMap map of 'YYYY-MM-DD' -> count
 * @returns {Array<{label: string, count: number}>}
 */
function bucketDailyCounts(dailyMap)
{
    const dayKeys = Object.keys(dailyMap).sort()
    if (dayKeys.length === 0) return []

    const minDate = new Date(dayKeys[0])
    const maxDate = new Date(dayKeys[dayKeys.length - 1])
    const diffDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)

    // Select aggregation function
    let groupFn, incrementFn, formatLabel
    if (diffDays <= 62) {
        // Daily
        groupFn = d => d.toISOString().split('T')[0]
        incrementFn = d => {
            const n = new Date(d)
            n.setUTCDate(n.getUTCDate() + 1)
            return n
        }
        formatLabel = key => {
            const date = new Date(key) // <- convert string back to Date
            return date.toLocaleDateString('en-GB', {
                month: '2-digit',
                day: '2-digit'
            })
        }

    } else if (diffDays <= 366) {
        // Weekly: Monday key
        groupFn = d => {
            const date = new Date(d)
            const day = date.getUTCDay()
            const diffToMonday = (day + 6) % 7
            const monday = new Date(date)
            monday.setUTCDate(date.getUTCDate() - diffToMonday)
            return monday.toISOString().split('T')[0]
        }
        incrementFn = d => {
            const n = new Date(d)
            n.setUTCDate(n.getUTCDate() + 7)
            return n
        }
        formatLabel = key => {
            const monday = new Date(key)
            const sunday = new Date(monday)
            sunday.setUTCDate(monday.getUTCDate() + 6)
            return `${monday.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit'
            })} - ${sunday.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit'
            })}`
        }
    } else {
        // Monthly
        groupFn = d => {
            const date = new Date(d)
            return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1)
                .toString()
                .padStart(2, '0')}`
        }
        incrementFn = d => {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
        }
        formatLabel = key => key
    }

    // Aggregate the daily counts into the chosen period buckets
    const counts = {}
    for (const [dayStr, count] of Object.entries(dailyMap)) {
        const key = groupFn(new Date(dayStr))
        counts[key] = (counts[key] || 0) + count
    }

    // Fill missing periods with zero counts
    const results = []
    let current = new Date(minDate)
    if (diffDays > 62 && diffDays <= 366) {
        // Weekly: adjust to Monday
        const day = current.getUTCDay()
        current.setUTCDate(current.getUTCDate() - ((day + 6) % 7))
    } else if (diffDays > 366) {
        // Monthly: first of month
        current.setUTCDate(1)
    }

    while (current <= maxDate) {
        const key = groupFn(current)
        results.push({label: formatLabel(key), count: counts[key] || 0})
        current = incrementFn(current)
    }

    return results

}

async function getDashboardMessages({from, to})
{
    if (!from) from = daysAgoString(30)
    if (!to) to = daysAgoString(0)

    const dailyMap = await getDailyCountsCached('messages', {}, from, to)
    return bucketDailyCounts(dailyMap)
}

async function getScreenshotMessages({from, to})
{
    if (!from) from = daysAgoString(30)
    if (!to) to = daysAgoString(0)

    const extraWhere = { content: { contains: '%\\%\\%%' } }
    const dailyMap = await getDailyCountsCached('screenshot', extraWhere, from, to)
    return bucketDailyCounts(dailyMap)
}

/**
 * Cache an immutable historical aggregation (≤ yesterday) for a day and a
 * short-lived today's aggregation, then merge the two count maps by key.
 *
 * computeFn(fromDate, toDate) must return an array of { key, count }.
 *
 * NOTE: historical and today's slices are each capped at the top 100 keys, so
 * the merge is approximate at the tail (a key just outside the historical top
 * 100 could be undercounted once today is added). Today's volume is negligible
 * versus all-time totals, so this is acceptable for the dashboard's "top 100".
 *
 * @returns {Promise<Array<[any, number]>>} merged [key, count] pairs, sorted desc
 */
async function getAggregateCached(keyBase, computeFn, from, to)
{
    const { today, histEnd, includeToday } = splitRange(from, to)

    const merged = new Map()
    const addEntries = entries => {
        for (const { key, count } of entries) {
            merged.set(key, (merged.get(key) || 0) + count)
        }
    }

    if (from <= histEnd) {
        const histKey = cachePrefix + `stats:agg:${keyBase}:${from}_${histEnd}`
        const hist = await getOrCompute(histKey, historicalExpiration, () => {
            const { fromDate, toDate } = getDates(from, histEnd)
            return computeFn(fromDate, toDate)
        })
        addEntries(hist)
    }

    if (includeToday) {
        const todayKey = cachePrefix + `stats:agg:${keyBase}:today:${today}`
        const todayAgg = await getOrCompute(todayKey, expiration, () => {
            const { fromDate, toDate } = getDates(today, today)
            return computeFn(fromDate, toDate)
        })
        addEntries(todayAgg)
    }

    return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100)
}

async function computeTopMessages(fromDate, toDate)
{
    const grouped = await prisma.message.groupBy({
        by: ['content'], // group by content
        _count: {
            content: true
        },
        where: {
            createdAt: {
                gte: fromDate,
                lte: toDate
            },
            AND: [
                { content: { not: { startsWith: 'td' } } },
                { content: { not: { startsWith: 'command' } } },
                { content: { not: { startsWith: 'alt' } } },
                { content: { notIn:  languages } },
            ]
        },
        orderBy: {
            _count: {
                content: 'desc'
            }
        },
        take: 100,
    })

    return grouped.map(group => ({ key: group.content, count: group._count.content }))
}

async function getTopMessages({from, to})
{
    if (!from) from = daysAgoString(30)
    if (!to) to = daysAgoString(0)

    const merged = await getAggregateCached('top-messages', computeTopMessages, from, to)

    return merged.map(([command, count], index) => ({
        position: index + 1,
        command,
        count
    }))
}

async function computeTopUsers(fromDate, toDate)
{
    const grouped = await prisma.message.groupBy({
        by: ['authorId'],
        _count: {
            content: true
        },
        where: {
            createdAt: {
                gte: fromDate,
                lte: toDate
            }
        },
        orderBy: {
            _count: {
                content: 'desc'
            }
        },
        take: 100,
    })

    return grouped.map(group => ({ key: group.authorId, count: group._count.content }))
}

async function getTopUsers({from, to})
{
    if (!from) from = daysAgoString(30)
    if (!to) to = daysAgoString(0)

    const merged = await getAggregateCached('top-users', computeTopUsers, from, to)
    const userIds = merged.map(([authorId]) => authorId)

    const users = await prisma.user.findMany({
        where: {
            id: { in: userIds }
        },
        select: {
            id: true,
            name: true,
            discordId: true,
        }
    })

    return merged.map(([authorId, count]) => {
        const user = users.find(u => u.id === authorId)
        return {
            authorId,
            username: user?.name || 'Unknown',
            discordId: user?.discordId || 'N/A',
            count
        }
    }).filter(user => user.username !== 'Катюха')
}

/**
 *
 * @param date
 * @param full
 * @returns {string}
 */
function formatDate(date, full=false)
{

    if (!full) {
        return new Intl.DateTimeFormat('en-GB', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            timeZoneName: 'short',
        }).format(date)
    }

    return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short',
    }).format(date)

}

function daysAgoString(days) {
    const now = new Date()
    const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    return pastDate.toISOString().split('T')[0]
}

function getDates(from, to)
{
    let fromDate = from ? new Date(from) : new Date()
    let toDate = to ? new Date(to) : new Date()

    // Ensure fromDate is at UTC midnight
    fromDate = new Date(
        Date.UTC(
            fromDate.getUTCFullYear(),
            fromDate.getUTCMonth(),
            fromDate.getUTCDate(),
            0, 0, 0
        )
    )

    // Ensure toDate is at end of day UTC
    toDate = new Date(
        Date.UTC(
            toDate.getUTCFullYear(),
            toDate.getUTCMonth(),
            toDate.getUTCDate(),
            23, 59, 59
        )
    )

    return { fromDate, toDate }
}

module.exports = {
    createMessage,
    getDashboardMessages,
    getMessages,
    getUserMessages,
    getProfileStats,
    getScreenshotMessages,
    getTopMessages,
    getTopUsers,
    daysAgoString,
}