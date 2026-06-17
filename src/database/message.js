const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
//profile stats cache lifetime (seconds)
const profileExpiration = parseInt(process.env.REDIS_EXP_PROFILE) || 60 * 5
const STATS_PERIODS = ['yearly', 'quarterly', 'monthly', 'daily']
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
 * both the DB workload and the cached payload stay small.
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

async function getMessages({ from, to, page = "1", pageSize = "50", username, command } = {})
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

    // Add a message filter if provided
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
                    select: { id: true, name: true }
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


async function getDashboardMessages({period} = {})
{
    return getStatsPeriodCountsCached('messages', {}, normalizeStatsPeriod(period))
}

async function getScreenshotMessages({period} = {})
{
    const extraWhere = { content: { contains: '%\\%\\%%' } }
    return getStatsPeriodCountsCached('screenshot', extraWhere, normalizeStatsPeriod(period))
}


function normalizeStatsPeriod(period)
{
    return STATS_PERIODS.includes(period) ? period : 'daily'
}

function addUtcDays(date, days)
{
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + days
    ))
}

function addUtcMonths(date, months)
{
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function addUtcYears(date, years)
{
    return new Date(Date.UTC(date.getUTCFullYear() + years, 0, 1))
}

function startOfStatsPeriod(period, date)
{
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (period === 'yearly') return new Date(Date.UTC(year, 0, 1))
    if (period === 'quarterly') return new Date(Date.UTC(year, month - (month % 3), 1))
    if (period === 'monthly') return new Date(Date.UTC(year, month, 1))
    return new Date(Date.UTC(year, month, date.getUTCDate()))
}

function nextStatsPeriod(period, date)
{
    if (period === 'yearly') return addUtcYears(date, 1)
    if (period === 'quarterly') return addUtcMonths(date, 3)
    if (period === 'monthly') return addUtcMonths(date, 1)
    return addUtcDays(date, 1)
}

function statsPeriodKey(period, date)
{
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (period === 'yearly') return `${year}`
    if (period === 'quarterly') return `${year}-Q${Math.floor(month / 3) + 1}`
    if (period === 'monthly') return `${year}-${(month + 1).toString().padStart(2, '0')}`
    return date.toISOString().split('T')[0]
}

function statsPeriodLabel(period, date)
{
    if (period === 'daily') {
        return date.toLocaleDateString('en-GB', {month: '2-digit', day: '2-digit'})
    }
    return statsPeriodKey(period, date)
}

function statsPeriodLookback(period)
{
    if (period === 'quarterly') return 8
    if (period === 'monthly') return 12
    return 30
}

async function getStatsFirstMessageDate(extraWhere = {})
{
    const first = await prisma.message.findFirst({
        where: extraWhere,
        orderBy: {createdAt: 'asc'},
        select: {createdAt: true},
    })
    return first?.createdAt || new Date()
}

function firstDailyCountDate(dailyMap)
{
    const first = Object.keys(dailyMap).
    filter(day => !day.startsWith('__')).
    sort().
    shift()
    return first ? new Date(`${first}T00:00:00Z`) : new Date()
}

function buildStatsBuckets(period, firstDate = null)
{
    period = normalizeStatsPeriod(period)
    const todayStart = startOfStatsPeriod('daily', new Date())
    const bucketPeriod = period
    const currentStart = startOfStatsPeriod(bucketPeriod, todayStart)
    let start

    if (period === 'yearly') {
        start = startOfStatsPeriod('yearly', firstDate || currentStart)
    } else {
        const bucketCount = statsPeriodLookback(period)
        if (period === 'quarterly') start = addUtcMonths(currentStart, -(bucketCount - 1) * 3)
        else if (period === 'monthly') start = addUtcMonths(currentStart, -(bucketCount - 1))
        else start = addUtcDays(currentStart, -(bucketCount - 1))
    }

    const buckets = []
    for (let current = start; current <= currentStart; current = nextStatsPeriod(bucketPeriod, current)) {
        const next = nextStatsPeriod(bucketPeriod, current)
        buckets.push({
            key: statsPeriodKey(bucketPeriod, current),
            label: statsPeriodLabel(bucketPeriod, current),
            fromDate: current,
            toDate: new Date(next.getTime() - 1),
            completed: next <= todayStart,
        })
    }

    return buckets
}

async function getStatsPeriodCached(cacheNamespace, period, bucket, computeFn)
{
    const cacheKey = cachePrefix + `stats:${cacheNamespace}:${period}:${bucket.key}`
    let cached = await redis.json.get(cacheKey, '$')
    if (cached === null || cached === undefined) {
        cached = await computeFn(bucket.fromDate, bucket.toDate)
        await redis.json.set(cacheKey, '$', cached)
        if (!bucket.completed) await redis.expire(cacheKey, expiration)
    }
    return cached
}

function dailyCountKey(date)
{
    return date.toISOString().split('T')[0]
}

function mergeDailyCounts(target, source)
{
    for (const [day, count] of Object.entries(source)) {
        if (day.startsWith('__')) continue
        target[day] = (target[day] || 0) + count
    }
}

function latestDailyCountKey(counts)
{
    return Object.keys(counts).
    filter(day => !day.startsWith('__')).
    sort().
    pop()
}

async function getDailyCountMap(extraWhere, fromDate, toDate)
{
    const messages = await prisma.message.findMany({
        where: {
            createdAt: {gte: fromDate, lte: toDate},
            ...extraWhere,
        },
        select: {createdAt: true},
    })

    const counts = {}
    for (const message of messages) {
        const key = dailyCountKey(message.createdAt)
        counts[key] = (counts[key] || 0) + 1
    }
    return counts
}

async function getDailyCountSourceCached(keyBase, extraWhere)
{
    const todayStart = startOfStatsPeriod('daily', new Date())
    const today = dailyCountKey(todayStart)
    const yesterdayEnd = new Date(todayStart.getTime() - 1)
    const yesterday = dailyCountKey(yesterdayEnd)
    const dailyMap = {}

    const historicalKey = cachePrefix + `stats:count-source:${keyBase}:historical`
    let historical = await redis.json.get(historicalKey, '$')
    if (historical === null || historical === undefined) {
        historical = {}
        const firstDate = await getStatsFirstMessageDate(extraWhere)
        const historicalStart = startOfStatsPeriod('daily', firstDate)
        if (historicalStart <= yesterdayEnd) {
            historical = await getDailyCountMap(extraWhere, historicalStart, yesterdayEnd)
        }
        historical.__through = yesterday
        await redis.json.set(historicalKey, '$', historical)
    } else if (historical.__through !== yesterday) {
        const through = historical.__through || latestDailyCountKey(historical)
        const firstDate = through
            ? addUtcDays(new Date(`${through}T00:00:00Z`), 1)
            : startOfStatsPeriod('daily', await getStatsFirstMessageDate(extraWhere))

        if (firstDate <= yesterdayEnd) {
            const missingCounts = await getDailyCountMap(extraWhere, firstDate, yesterdayEnd)
            mergeDailyCounts(historical, missingCounts)
        }
        historical.__through = yesterday
        await redis.json.set(historicalKey, '$', historical)
    }
    mergeDailyCounts(dailyMap, historical)

    const todayKey = cachePrefix + `stats:count-source:${keyBase}:today:${today}`
    let todayMap = await redis.json.get(todayKey, '$')
    if (todayMap === null || todayMap === undefined) {
        todayMap = await getDailyCountMap(extraWhere, todayStart, new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1))
        await redis.json.set(todayKey, '$', todayMap)
        await redis.expire(todayKey, expiration)
    }
    mergeDailyCounts(dailyMap, todayMap)

    return dailyMap
}

function statsBucketValue(period, bucket, dailyMap)
{
    if (period === 'daily') return dailyMap[dailyCountKey(bucket.fromDate)] || 0

    let count = 0
    for (const [day, value] of Object.entries(dailyMap)) {
        const date = new Date(day)
        if (date >= bucket.fromDate && date <= bucket.toDate) count += value
    }
    return count
}

async function getStatsPeriodCountsCached(keyBase, extraWhere, period)
{
    period = normalizeStatsPeriod(period)
    const dailyMap = await getDailyCountSourceCached(keyBase, extraWhere)
    const results = []
    const firstDate = period === 'yearly' ? firstDailyCountDate(dailyMap) : null
    for (const bucket of buildStatsBuckets(period, firstDate)) {
        results.push({label: bucket.label, count: statsBucketValue(period, bucket, dailyMap)})
    }
    return results
}

async function getStatsPeriodAggregateCached(keyBase, computeFn, period)
{
    period = normalizeStatsPeriod(period)
    const firstDate = period === 'yearly' ? await getStatsFirstMessageDate() : null
    const buckets = buildStatsBuckets(period, firstDate)
    const first = buckets[0]
    const last = buckets[buckets.length - 1]
    const entries = await getStatsPeriodCached(
        `agg-period:${keyBase}`,
        period,
        {
            key: 'range',
            fromDate: first.fromDate,
            toDate: last.toDate,
            completed: last.completed,
        },
        computeFn
    )

    return entries.map(({key, count}) => [key, count])
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

async function getTopMessages({period} = {})
{
    const merged = await getStatsPeriodAggregateCached('top-messages', computeTopMessages, period)

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

async function getTopUsers({period} = {})
{
    const merged = await getStatsPeriodAggregateCached('top-users', computeTopUsers, period)
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
}
