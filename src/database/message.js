const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()


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
 * @param skip
 * @param take
 * @returns {Promise<array>}
 */
async function getMessages(userId, skip=0,take=10)
{
    return await prisma.message.findMany({
        skip: skip,
        take: take,
        where: {
            authorId: userId,
        },
        orderBy: {
            createdAt: 'desc'
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @returns {Promise<*>}
 */
async function getLastDayMessages()
{
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

    return messages.map(message => ({
        ...message,
        createdAt: formatDate(new Date(message.createdAt))
    }))

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

    return groupedCards.map(group => ({
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
 * @returns {string}
 */
function formatDate(date) {

    return new Intl.DateTimeFormat('en-GB', {
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