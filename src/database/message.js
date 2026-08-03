const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()

const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
//profile stats cache lifetime (seconds)
const profileExpiration = parseInt(process.env.REDIS_EXP_PROFILE) || 60 * 5
// Dashboard chart periods, plus 'daily' — the rolling 30-day series the
// mini-counters read. Each maps to a chart granularity + date window in
// periodPlan(); 'daily' stays a fixed 30-day window.
const STATS_PERIODS = ['current-month', 'last-month', 'current-year', 'last-year', 'all-time', 'daily']
const {languages} = require('../tools/language')
// A screenshot command is anything that asks for a deck render: a deck code,
// which bot.js recognises by its %% prefix, or a kards.com deck link (see
// bot.isDeckLink). Both go through Browserless, so both belong in the count.
// Prisma passes `contains` values into LIKE untouched, hence the escaped
// percent signs in the deck-code pattern.
const screenshotCommandWhere = {
    OR: [
        { content: { contains: '%\\%\\%%' } },
        {
            AND: [
                { content: { contains: 'https://www.kards.com/' } },
                { content: { contains: '/decks/' } },
            ],
        },
    ],
}
// Cache namespace for the daily counts above. The historical half of that
// cache never expires, so this changes whenever the filter does — otherwise
// counts taken under the old filter would be served forever.
const screenshotCommandKeyBase = 'screenshot-commands'
const topMessageContentFilters = [
    { content: { not: { startsWith: 'td' } } },
    { content: { not: { startsWith: 'command' } } },
    { content: { not: { startsWith: 'alt' } } },
    { content: { notIn:  languages } },
]
/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createMessage(data)
{
    return await prisma.message.create({
        data: data
    })
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
    })

    messages.lastDayMessages =  lastDayMessages.map(message => ({
        ...message,
        timestamp: message.createdAt,
        createdAt: formatDate(new Date(message.createdAt))
    }))

    messages.totalCount = await prisma.message.count({
        where: {
            authorId: userId,
        }
    })

    await redis.json.set(cacheKey, '$', messages)
    await redis.expire(cacheKey, expiration)

    return messages

}

/**
 * Lightweight per-user stats for the profile overview, cached in Redis. Only
 * the counts and leaderboard positions are queried and stored (no message
 * rows), so both the DB workload and the cached payload stay small.
 *
 * @param userId User table primary key
 * @returns {Promise<{total: number, currentMonth: number, lastDay: number, allTimePosition: (number|null), currentMonthPosition: (number|null)}>}
 */
async function getProfileStats(userId)
{
    const cacheKey = cachePrefix + 'profile:stats:' + userId
    const cached = normalizeRedisJsonObject(await redis.json.get(cacheKey, '$'))
    if (cached
        && cached.currentMonth !== undefined
        && cached.allTimePosition !== undefined
        && cached.currentMonthPosition !== undefined) {
        return cached
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const monthStart = startOfCurrentMonthUtc()

    const [total, currentMonth, lastDay, allTimePositions, currentMonthPositions] = await Promise.all([
        prisma.message.count({where: {authorId: userId}}),
        prisma.message.count({
            where: {authorId: userId, createdAt: {gte: monthStart}},
        }),
        prisma.message.count({
            where: {authorId: userId, createdAt: {gte: dayAgo}},
        }),
        getAllTimeUserMessagePositions([userId]),
        getCurrentMonthUserMessagePositions([userId]),
    ])

    const stats = {
        total,
        currentMonth,
        lastDay,
        allTimePosition: allTimePositions[String(userId)] || null,
        currentMonthPosition: currentMonthPositions[String(userId)] || null,
    }
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

async function getTotalMessageCount()
{
    return await prisma.message.count()
}

async function getScreenshotMessages({period} = {})
{
    return getStatsPeriodCountsCached(
        screenshotCommandKeyBase, screenshotCommandWhere, normalizeStatsPeriod(period))
}

async function getTotalScreenshotCommandCount()
{
    return await prisma.message.count({where: screenshotCommandWhere})
}


function normalizeStatsPeriod(period)
{
    return STATS_PERIODS.includes(period) ? period : 'current-month'
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

// The functions below work on a chart *granularity* — 'daily', 'monthly' or
// 'quarterly' — the size of a single bucket. A UI period (current-month,
// all-time, …) is mapped to a granularity plus a date window by periodPlan().

function startOfGranularity(granularity, date)
{
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (granularity === 'quarterly') return new Date(Date.UTC(year, month - (month % 3), 1))
    if (granularity === 'monthly') return new Date(Date.UTC(year, month, 1))
    return new Date(Date.UTC(year, month, date.getUTCDate()))
}

function nextGranularity(granularity, date)
{
    if (granularity === 'quarterly') return addUtcMonths(date, 3)
    if (granularity === 'monthly') return addUtcMonths(date, 1)
    return addUtcDays(date, 1)
}

function granularityKey(granularity, date)
{
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    if (granularity === 'quarterly') return `${year}-Q${Math.floor(month / 3) + 1}`
    if (granularity === 'monthly') return `${year}-${(month + 1).toString().padStart(2, '0')}`
    return date.toISOString().split('T')[0]
}

function granularityLabel(granularity, date)
{
    if (granularity === 'daily') {
        return date.toLocaleDateString('en-GB', {month: '2-digit', day: '2-digit'})
    }
    return granularityKey(granularity, date)
}

// Whether the data spans more than five years, deciding the all-time chart's
// granularity: quarters past that point (else the axis would carry 60+ month
// buckets), months below it.
function allTimeGranularity(firstDate, now)
{
    const fiveYearsAgo = new Date(Date.UTC(
        now.getUTCFullYear() - 5,
        now.getUTCMonth(),
        now.getUTCDate()
    ))
    return firstDate < fiveYearsAgo ? 'quarterly' : 'monthly'
}

// Map a UI period to the chart granularity and the inclusive [start, end]
// window of bucket-start dates to render. `firstDate` (first day with data) is
// only consulted for all-time.
function periodPlan(period, firstDate)
{
    const now = new Date()
    const todayStart = startOfGranularity('daily', now)
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth()

    if (period === 'daily') {
        // Rolling 30-day window for the mini-counters (not shown in the chart).
        return {granularity: 'daily', start: addUtcDays(todayStart, -29), end: todayStart}
    }
    if (period === 'last-month') {
        const thisMonthStart = new Date(Date.UTC(year, month, 1))
        return {
            granularity: 'daily',
            start: new Date(Date.UTC(year, month - 1, 1)),
            end: addUtcDays(thisMonthStart, -1),
        }
    }
    if (period === 'current-year') {
        // January of this year through the current month, one bucket per month.
        return {
            granularity: 'monthly',
            start: new Date(Date.UTC(year, 0, 1)),
            end: new Date(Date.UTC(year, month, 1)),
        }
    }
    if (period === 'last-year') {
        return {
            granularity: 'monthly',
            start: new Date(Date.UTC(year - 1, 0, 1)),
            end: new Date(Date.UTC(year - 1, 11, 1)),
        }
    }
    if (period === 'all-time') {
        const first = firstDate || todayStart
        const granularity = allTimeGranularity(first, now)
        return {
            granularity,
            start: startOfGranularity(granularity, first),
            end: startOfGranularity(granularity, todayStart),
        }
    }
    // current-month (default): the days of the current month so far.
    return {
        granularity: 'daily',
        start: new Date(Date.UTC(year, month, 1)),
        end: todayStart,
    }
}

function normalizeRedisJsonObject(value) {
    if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
        return value[0]
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
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
    const todayStart = startOfGranularity('daily', new Date())
    const {granularity, start, end} = periodPlan(period, firstDate)

    const buckets = []
    for (let current = start; current <= end; current = nextGranularity(granularity, current)) {
        const next = nextGranularity(granularity, current)
        buckets.push({
            granularity,
            key: granularityKey(granularity, current),
            label: granularityLabel(granularity, current),
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
    const todayStart = startOfGranularity('daily', new Date())
    const today = dailyCountKey(todayStart)
    const yesterdayEnd = new Date(todayStart.getTime() - 1)
    const yesterday = dailyCountKey(yesterdayEnd)
    const dailyMap = {}

    const historicalKey = cachePrefix + `stats:count-source:${keyBase}:historical`
    let historical = await redis.json.get(historicalKey, '$')
    if (historical === null || historical === undefined) {
        historical = {}
        const firstDate = await getStatsFirstMessageDate(extraWhere)
        const historicalStart = startOfGranularity('daily', firstDate)
        if (historicalStart <= yesterdayEnd) {
            historical = await getDailyCountMap(extraWhere, historicalStart, yesterdayEnd)
        }
        historical.__through = yesterday
        await redis.json.set(historicalKey, '$', historical)
    } else if (historical.__through !== yesterday) {
        const through = historical.__through || latestDailyCountKey(historical)
        const firstDate = through
            ? addUtcDays(new Date(`${through}T00:00:00Z`), 1)
            : startOfGranularity('daily', await getStatsFirstMessageDate(extraWhere))

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

function statsBucketValue(bucket, dailyMap)
{
    if (bucket.granularity === 'daily') return dailyMap[dailyCountKey(bucket.fromDate)] || 0

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
    const firstDate = period === 'all-time' ? firstDailyCountDate(dailyMap) : null
    for (const bucket of buildStatsBuckets(period, firstDate)) {
        results.push({label: bucket.label, count: statsBucketValue(bucket, dailyMap)})
    }
    return results
}

async function getStatsPeriodAggregateCached(keyBase, computeFn, period)
{
    period = normalizeStatsPeriod(period)
    const firstDate = period === 'all-time' ? await getStatsFirstMessageDate() : null
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
            AND: topMessageContentFilters
        },
        orderBy: {
            _count: {
                content: 'desc'
            }
        },
        take: 1000,
    })

    return grouped.map(group => ({ key: group.content, count: group._count.content }))
}

function mergePositionRows(positions, rows, key) {
    for (const row of rows) {
        const value = row[key]
        if (value !== undefined && value !== null) {
            positions[String(value)] = Number(row.position)
        }
    }
    return positions
}

async function getAllTimeMessagePositions(commands = []) {
    commands = [...new Set(commands.filter(command => command !== undefined && command !== null))]
    if (!commands.length) return {}

    const cacheKey = cachePrefix + 'stats:all-time:message-positions'
    let positions = normalizeRedisJsonObject(await redis.json.get(cacheKey, '$'))
    positions = positions || {}
    const missing = commands.filter(command => positions[String(command)] === undefined)
    if (!missing.length) return positions

    const rows = await prisma.$queryRaw`
        SELECT ranked.content, ranked.position
        FROM (
            SELECT content, RANK() OVER (ORDER BY COUNT(*) DESC) AS position
            FROM "Message"
            WHERE content IS NOT NULL
              AND content NOT LIKE '-> td%'
              AND content NOT IN (${Prisma.join(languages)})
            GROUP BY content
        ) ranked
        WHERE ranked.content IN (${Prisma.join(missing)})
    `

    mergePositionRows(positions, rows, 'content')
    await redis.json.set(cacheKey, '$', positions)
    await redis.expire(cacheKey, expiration)
    return positions
}

async function getTopMessages({period} = {})
{
    const merged = await getStatsPeriodAggregateCached('top-messages', computeTopMessages, period)

    const aggregatedMap = merged.reduce((acc, [command, count]) => {
        const cleanCommand = command.split(' -> ').pop()
        if (cleanCommand.startsWith('%%')) return acc

        if (!acc[cleanCommand]) acc[cleanCommand] = 0
        acc[cleanCommand] += count
        return acc
    }, {})

    const aggregatedArr = Object.entries(aggregatedMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)

    const allTimePositions = await getAllTimeMessagePositions(aggregatedArr.map(([command]) => command))

    return aggregatedArr.map(([command, count], index) => ({
        position: index + 1,
        allTimePosition: allTimePositions[String(command)] || null,
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

// UTC midnight on the first of the current calendar month — the lower bound
// for the current-month leaderboard.
function startOfCurrentMonthUtc()
{
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// Shared cache-then-RANK() logic for the two user leaderboards below. `runQuery`
// gets the still-uncached authorIds and returns their {authorId, position} rows;
// positions accumulate per authorId under `cacheKey`.
async function resolveUserMessagePositions(authorIds, cacheKey, runQuery)
{
    authorIds = [...new Set(authorIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0))]
    if (!authorIds.length) return {}

    let positions = normalizeRedisJsonObject(await redis.json.get(cacheKey, '$'))
    positions = positions || {}
    const missing = authorIds.filter(authorId => positions[String(authorId)] === undefined)
    if (!missing.length) return positions

    const rows = await runQuery(missing)

    mergePositionRows(positions, rows, 'authorId')
    await redis.json.set(cacheKey, '$', positions)
    await redis.expire(cacheKey, expiration)
    return positions
}

async function getAllTimeUserMessagePositions(authorIds = []) {
    return resolveUserMessagePositions(
        authorIds,
        cachePrefix + 'stats:all-time:user-message-positions',
        missing => prisma.$queryRaw`
            SELECT ranked."authorId", ranked.position
            FROM (
                SELECT "authorId", RANK() OVER (ORDER BY COUNT(*) DESC) AS position
                FROM "Message"
                GROUP BY "authorId"
            ) ranked
            WHERE ranked."authorId" IN (${Prisma.join(missing)})
        `,
    )
}

async function getCurrentMonthUserMessagePositions(authorIds = []) {
    const monthStart = startOfCurrentMonthUtc()
    // Month in the key so a new month starts a fresh ranking rather than
    // reusing last month's cached positions.
    const monthKey = `${monthStart.getUTCFullYear()}-${(monthStart.getUTCMonth() + 1).toString().padStart(2, '0')}`
    return resolveUserMessagePositions(
        authorIds,
        cachePrefix + `stats:current-month:user-message-positions:${monthKey}`,
        missing => prisma.$queryRaw`
            SELECT ranked."authorId", ranked.position
            FROM (
                SELECT "authorId", RANK() OVER (ORDER BY COUNT(*) DESC) AS position
                FROM "Message"
                WHERE "createdAt" >= ${monthStart}
                GROUP BY "authorId"
            ) ranked
            WHERE ranked."authorId" IN (${Prisma.join(missing)})
        `,
    )
}

async function getTopUsers({period} = {})
{
    const merged = await getStatsPeriodAggregateCached('top-users', computeTopUsers, period)
    const userIds = merged.map(([authorId]) => authorId)
    const allTimePositions = await getAllTimeUserMessagePositions(userIds)

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
            allTimePosition: allTimePositions[String(authorId)] || null,
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
    getTotalMessageCount,
    getTotalScreenshotCommandCount,
    // Exported for unit testing the chart bucketing.
    buildStatsBuckets,
}
