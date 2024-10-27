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

module.exports = {createMessage, getMessages, getLastDayMessages }