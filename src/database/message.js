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

async function getMessages({ from, to, page = 1, pageSize = 50 } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1)
    const size = Math.max(1, parseInt(pageSize, 10) || 50)

    let fromDate = from ? new Date(from) : new Date()
    let toDate = to ? new Date(to) : new Date()

// Ensure fromDate is at UTC midnight
    fromDate = new Date(
        Date.UTC(
            fromDate.getUTCFullYear(),
            fromDate.getUTCMonth(),
            fromDate.getUTCDate(),
            0, 0, 0)
    )
    toDate = new Date(
        Date.UTC(
            toDate.getUTCFullYear(),
            toDate.getUTCMonth(),
            toDate.getUTCDate(),
            23, 59, 59)
    )

    const fromString = new Date(fromDate).toISOString().split('T')[0]
    const toString = new Date(toDate).toISOString().split('T')[0]
    const cacheKey = cachePrefix + 'page:messages:' + fromString + toString + '_' + page + '_' + pageSize
    const cachedMessages = await redis.json.get(cacheKey, '$')
    if (cachedMessages) return cachedMessages

    const where = {
        createdAt: {
            gte: fromDate,
            lte: toDate
        }
    }

    // run count and find in parallel
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
        pageSize: size
    }

    await redis.json.set(cacheKey, '$', result)
    await redis.expire(cacheKey, expiration)

    return result
}


async function getMessagesByArgs(args)
{
    // Ensure we only select 'createdAt' from the DB
    const messages = await prisma.message.findMany({
        ...args,
        select: {
            createdAt: true
        }
    })

    // Aggregate message counts by day
    const messageCountsByDay = messages.reduce((acc, message) => {
        const day = message.createdAt.toISOString().split('T')[0]; // Get YYYY-MM-DD format
        acc[day] = (acc[day] || 0) + 1;
        return acc;
    }, {})

    // Format data for Chart.js, with MM-DD for labels
    return Object.keys(messageCountsByDay).map((day) => ({
        label: new Date(day).toLocaleDateString('en-GB', { month: '2-digit', day: '2-digit' }),
        count: messageCountsByDay[day],
    }))
}

async function getLastMonthMessages()
{
    const monthAgo = new Date(new Date() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

    const args = {
        where: {
            createdAt: {
                gte: monthAgo,
            },
        },
        orderBy: {
            createdAt: 'asc',
        },
    }

    return await getMessagesByArgs(args)

}

async function getTopDeckMessages()
{
    const monthAgo = new Date(new Date() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

    const args = {
        where: {
            createdAt: {
                gte: monthAgo,
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

async function getTopMessages()
{
    const monthAgo = new Date(new Date() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

    const groupedCards = await prisma.message.groupBy({
        by: ['content'], // group by content
        _count: {
            content: true
        },
        where: {
            createdAt: {
                gte: monthAgo,
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

async function getTopUsers()
{
    const monthAgo = new Date(new Date() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

    const groupedMessages = await prisma.message.groupBy({
        by: ['authorId'],
        _count: {
            content: true
        },
        where: {
            createdAt: {
                gte: monthAgo,
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

    return groupedMessages.map((group, index) => {
        const user = users.find(u => u.id === group.authorId)
        return {
            authorId: group.authorId,
            position: index + 1,
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

module.exports = {
    createMessage,
    getLastMonthMessages,
    getMessages,
    getUserMessages,
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
}