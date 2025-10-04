const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
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

async function getMessagesByArgs(args) {
    // Only select 'createdAt' from DB
    const messages = await prisma.message.findMany({
        ...args,
        select: {createdAt: true}
    })

    if (messages.length === 0) return []

    // Determine min/max dates
    let minDate = new Date(messages[0].createdAt)
    let maxDate = new Date(messages[0].createdAt)
    for (const m of messages) {
        const d = new Date(m.createdAt)
        if (d < minDate) minDate = d
        if (d > maxDate) maxDate = d
    }

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
            const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
            return n
        }
        formatLabel = key => key
    }

    // Aggregate counts
    const counts = {}
    for (const m of messages) {
        const key = groupFn(m.createdAt)
        counts[key] = (counts[key] || 0) + 1
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

    const { fromDate, toDate } = getDates(from, to)

    const fromString = fromDate.toISOString().split('T')[0]
    const toString = toDate.toISOString().split('T')[0]
    const cacheKey = cachePrefix + `dashboard:messages:${fromString}_${toString}`

    const cachedMessages = await redis.json.get(cacheKey, '$')
    if (cachedMessages) return cachedMessages

    const args = {
        where: {
            createdAt: {
                gte: fromDate,
                lte: toDate
            },
        },
        orderBy: {
            createdAt: 'asc',
        },
    }

    return await getMessagesByArgs(args)

}

async function getTopDeckMessages({from, to})
{
    if (!from) from = daysAgoString(30)
    const { fromDate, toDate } = getDates(from, to)

    const args = {
        where: {
            createdAt: {
                gte: fromDate,
                lte: toDate
            },
            content: {
                startsWith: 'td',
            }
        },
        orderBy: {
            createdAt: 'asc',
        },
    }


    return await getMessagesByArgs(args)
}

async function getTopMessages({from, to})
{
    if (!from) from = daysAgoString(30)
    const { fromDate, toDate } = getDates(from, to)

    const groupedCards = await prisma.message.groupBy({
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

    return groupedCards.map( (group, index)  => ({
        position: index + 1,
        command: group.content,
        count: group._count.content
    }))

}

async function getTopUsers({from, to})
{
    if (!from) from = daysAgoString(30)
    const { fromDate, toDate } = getDates(from, to)

    const groupedMessages = await prisma.message.groupBy({
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

    const userIds = groupedMessages.map(group => group.authorId)

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

    return groupedMessages.map((group) => {
        const user = users.find(u => u.id === group.authorId)
        return {
            authorId: group.authorId,
            username: user?.name || 'Unknown',
            discordId: user?.discordId || 'N/A',
            count: group._count.content
        }
    }).filter (user => user.username !== 'Катюха')
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
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
    daysAgoString,
}