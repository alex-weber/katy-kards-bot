const { prisma, Prisma } = require('./prisma')

// Areas the Activity page can filter by. 'users' rows come from UserAuditLog
// (admin-made status/role changes); every other area lives in WebAuditLog.
const WEB_AUDIT_AREAS = Object.freeze(['commands', 'users', 'roles', 'system', 'servers', 'sync', 'auth'])

/**
 * Record one website action for the Activity page.
 *
 * @param actor the session user ({id, username}) who did it
 * @param area one of WEB_AUDIT_AREAS (not 'users')
 * @param action 'create' | 'update' | 'delete' | 'start' | 'login'
 * @param target what was touched (command key, guild name, …)
 * @param oldValue display value before the change (null when not applicable)
 * @param newValue display value after the change (null when not applicable)
 * @returns {Promise<*>}
 */
async function createWebAudit({ actor, area, action, target, oldValue, newValue })
{
    return await prisma.webAuditLog.create({
        data: {
            actorId: actor && actor.id ? String(actor.id) : null,
            actor: (actor && actor.username) || 'unknown',
            area,
            action,
            target: target ?? null,
            oldValue: oldValue ?? null,
            newValue: newValue ?? null,
        },
    })
}

/**
 * Website activity, newest first: WebAuditLog merged with the admin-made
 * entries of UserAuditLog (self-initiated ones — registration, accepting the
 * terms — are not website actions and stay on the users page only).
 *
 * @param page 1-based page number
 * @param pageSize rows per page
 * @param area optional WEB_AUDIT_AREAS filter
 * @param actor optional case-insensitive substring of the actor's name
 * @returns {Promise<{entries: array, totalCount: number}>}
 */
async function getWebAudits({ page = 1, pageSize = 50, area, actor } = {})
{
    const conditions = []
    if (area && WEB_AUDIT_AREAS.includes(area)) conditions.push(Prisma.sql`a."area" = ${area}`)
    if (actor) conditions.push(Prisma.sql`a."actor" ILIKE ${'%' + actor + '%'}`)
    const where = conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty

    const merged = Prisma.sql`
        SELECT w."id", w."createdAt", w."actor", w."area", w."action", w."target",
               w."oldValue", w."newValue", NULL::int AS "targetUserId"
        FROM "WebAuditLog" w
        UNION ALL
        SELECT u."id", u."createdAt", u."actor", 'users', u."field", usr."name",
               u."oldValue", u."newValue", u."userId"
        FROM "UserAuditLog" u
        JOIN "User" usr ON usr."id" = u."userId"
        WHERE u."actor" <> 'self'`

    const offset = (Math.max(1, page) - 1) * pageSize
    const entries = await prisma.$queryRaw`
        SELECT * FROM (${merged}) a ${where}
        ORDER BY a."createdAt" DESC, a."id" DESC
        LIMIT ${pageSize} OFFSET ${offset}`
    const [{ count }] = await prisma.$queryRaw`
        SELECT COUNT(*) AS count FROM (${merged}) a ${where}`

    return { entries, totalCount: Number(count) }
}

module.exports = {
    WEB_AUDIT_AREAS,
    createWebAudit,
    getWebAudits,
}
