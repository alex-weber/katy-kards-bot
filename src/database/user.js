const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const ROLE_PRIORITY = Object.freeze({
    GOD: 0,
    VIP: 1,
    SPECIAL: 2,
    STANDARD: 3,
    PRISONER: 4,
})

/**
 *
 * @param data
 * @returns {Promise<*>}
 */
async function createUser(data)
{

    return await prisma.user.create({
        data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param discordId
 * @returns {Promise<*>}
 */
async function getUser(discordId)
{
    let User = await prisma.user.findUnique({
        where: {
            discordId: discordId,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
    if (!User) {
        User = await createUser({
            discordId: discordId,
            language: 'en',
            //new users must accept the Terms of Service before using the bot;
            //the Discord terms flow flips this to 'active'. Telegram users are
            //auto-activated in the Telegram handler.
            status: 'pending',
            tdGames: 0,
            tdWins: 0,
            tdDraws: 0,
            tdLoses: 0,
        }).
        catch((e) => { throw e }).
        finally(async () => { await prisma.$disconnect() })
    }

    return User
}

/**
 * Look up a user by internal primary key. Used by the public profile page,
 * which links from the dashboard's top-users table (authorId === User.id).
 *
 * @param id internal User.id
 * @returns {Promise<*>}
 */
async function getUserById(id)
{
    return await prisma.user.findUnique({
        where: { id: parseInt(id, 10) },
        select: {
            id: true,
            name: true,
            discordId: true,
            language: true,
            status: true,
            role: true,
            mode: true,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

async function getUsers({ page = 1, pageSize = 50, username, discordId, role, status, mode } = {})
{
    const p = Math.max(1, parseInt(page, 10) || 1)
    const size = Math.max(1, parseInt(pageSize, 10) || 50)
    const where = {}

    if (username) {
        where.name = {
            contains: username,
            mode: 'insensitive'
        }
    }
    if (discordId) {
        where.discordId = {
            contains: discordId,
            mode: 'insensitive'
        }
    }
    if (role) {
        where.role = (role === '__empty' || role === 'STANDARD') ? null : role
    }
    if (status === 'active') {
        where.status = 'active'
    }
    if (status === 'inactive') {
        where.status = {
            not: 'active'
        }
    }
    if (mode) {
        where.mode = {
            contains: mode,
            mode: 'insensitive'
        }
    }

    const allUsers = await prisma.user.findMany({
        where,
        select: {
            id: true,
            discordId: true,
            name: true,
            language: true,
            status: true,
            role: true,
            mode: true,
            reactions: true,
            _count: {
                select: {
                    messages: true,
                },
            },
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    const totalCount = allUsers.length
    const users = sortUsersByRolePriority(allUsers).slice((p - 1) * size, p * size)

    return {
        users,
        totalCount,
        page: p,
        pageSize: size,
    }
}

function rolePriority(role)
{
    return ROLE_PRIORITY[role || 'STANDARD'] ?? ROLE_PRIORITY.STANDARD
}

function sortUsersByRolePriority(users)
{
    return users.sort((a, b) => {
        const roleDiff = rolePriority(a.role) - rolePriority(b.role)
        if (roleDiff) return roleDiff
        const messageDiff = (b._count?.messages || 0) - (a._count?.messages || 0)
        if (messageDiff) return messageDiff
        return b.id - a.id
    })
}

async function updateUserAdminFields(id, data)
{
    return await prisma.user.update({
        where: { id: parseInt(id, 10) },
        data,
        select: {
            id: true,
            discordId: true,
            name: true,
            language: true,
            status: true,
            role: true,
            mode: true,
        }
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 *
 * @param User
 * @returns {Promise<*>}
 */
async function updateUser(User)
{

    return await prisma.user.update({
        where: { id: User.id },
        data: User
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

module.exports = {
    getUser,
    getUserById,
    getUsers,
    updateUser,
    updateUserAdminFields,
}
