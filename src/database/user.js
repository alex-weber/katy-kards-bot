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
    const user = await prisma.user.create({
        data: data
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    // Record the registration in the users-page change log, so a brand-new
    // account shows up there the same way a later status/role change would.
    // Marked self-initiated: a user row is created the first time someone
    // uses the bot. `newValue` is the initial status (e.g. 'pending').
    await createUserAudit({
        userId: user.id,
        field: 'registered',
        oldValue: null,
        newValue: user.status,
        actor: 'self',
    })

    return user
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
    if (status === 'new') {
        // Filter-only pseudo-status: users who registered today (UTC), mirroring
        // the "New today" tile in the overview. Rows with a null createdAt are
        // excluded by the gte comparison.
        where.createdAt = { gte: startOfUtcToday() }
    } else if (status) {
        where.status = status === 'inactive'
            ? { not: 'active' }
            : status
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

// Statuses that get their own tile on the users page. Anything not in this
// list (admin-disabled 'inactive' users, plus any stray/legacy value) is
// counted as "banned" — see getUserStatusCounts.
const NAMED_STATUSES = Object.freeze(['active', 'pending', 'declined'])

function startOfUtcToday()
{
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Headline user counts for the users page: the total, one count per named
 * status, everything else lumped together as "banned", and how many users
 * registered today (UTC). One grouped query plus two counts.
 *
 * @returns {Promise<{total: number, active: number, pending: number, declined: number, banned: number, newToday: number}>}
 */
async function getUserStatusCounts()
{
    const [grouped, total, newToday] = await Promise.all([
        prisma.user.groupBy({
            by: ['status'],
            _count: { _all: true },
        }),
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: startOfUtcToday() } } }),
    ]).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })

    const counts = { total, active: 0, pending: 0, declined: 0, banned: 0, newToday }
    for (const row of grouped) {
        const status = (row.status || '').toLowerCase()
        if (NAMED_STATUSES.includes(status)) counts[status] += row._count._all
        else counts.banned += row._count._all
    }

    return counts
}

/**
 * Record a status/role change for the users-page audit log.
 *
 * @param userId internal User.id whose field changed
 * @param field 'status' | 'role'
 * @param oldValue display value before the change (null when unknown)
 * @param newValue display value after the change
 * @param actor admin username, or 'self' for a user-initiated change
 * @returns {Promise<*>}
 */
async function createUserAudit({ userId, field, oldValue, newValue, actor })
{
    return await prisma.userAuditLog.create({
        data: {
            userId: parseInt(userId, 10),
            field,
            oldValue: oldValue ?? null,
            newValue: newValue ?? null,
            actor,
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
}

/**
 * The most recent status/role changes, newest first, with each target user's
 * name and internal id for linking to their profile.
 *
 * @param limit how many entries to return
 * @returns {Promise<array>}
 */
async function getRecentUserAudits(limit = 20)
{
    return await prisma.userAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.max(1, parseInt(limit, 10) || 20),
        include: {
            user: {
                select: { id: true, name: true, discordId: true },
            },
        },
    }).
    catch((e) => { throw e }).
    finally(async () => { await prisma.$disconnect() })
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
    getUserStatusCounts,
    createUserAudit,
    getRecentUserAudits,
    updateUser,
    updateUserAdminFields,
}
