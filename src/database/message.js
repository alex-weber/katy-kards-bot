const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const {redis, cachePrefix} = require('../controller/redis')
const expiration = parseInt(process.env.CACHE_PAGE_EXPIRE) || 60*5
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
async function getMessages(userId)
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
 *
 * @returns {Promise<*>}
 */
async function getLastDayMessages()
{
    const cacheKey = cachePrefix + 'page:messages'
    const cachedMessages = await redis.json.get(cacheKey, '$')
    if (cachedMessages && cachedMessages.length > 0) return cachedMessages

    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const messages = await prisma.message.findMany({
        where: {
            createdAt: {
                gte: dayAgo,
            },
        },
        orderBy: {
            createdAt: 'desc'
        },
        include: {
            author: {
                select: {
                    name: true,
                },
            },
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    const mappedMessages = messages.map(message => ({
        ...message,
        createdAt: formatDate(new Date(message.createdAt))
    }))
    await redis.json.set(cacheKey, '$', mappedMessages)
    await redis.expire(cacheKey, expiration)

    return mappedMessages

}

async function getMessagesByArgs(args)
{
    const messages = await prisma.message.findMany(args)

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
    })

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
    getLastDayMessages,
    getLastMonthMessages,
    getMessages,
    getTopDeckMessages,
    getTopMessages,
    getTopUsers,
}