const {redis, cachePrefix: webCachePrefix} = require('../controller/redis')
const {cacheKeyPrefix: discordCachePrefix} = require('../controller/messageCache')

const ROLE = {
    GOD: 'GOD',
    VIP: 'VIP',
    SPECIAL: 'SPECIAL',
    STANDARD: 'STANDARD',
    PRISONER: 'PRISONER',
}

const ROLE_OPTIONS = [
    {value: ROLE.GOD, label: 'GOD', description: 'Superadmin'},
    {value: ROLE.VIP, label: 'VIP', description: 'Admin'},
    {value: ROLE.SPECIAL, label: 'Special', description: 'Pro User'},
    {value: ROLE.STANDARD, label: 'Standard', description: 'Default'},
    {value: ROLE.PRISONER, label: 'Prisoner', description: 'Limited rights'},
]

const KNOWN_ROLES = new Set(ROLE_OPTIONS.map(option => option.value))
const MANAGER_ROLES = new Set([ROLE.GOD, ROLE.VIP])
const EDITABLE_RULE_ROLES = [ROLE.SPECIAL, ROLE.STANDARD, ROLE.PRISONER]
const roleRulesCacheKey = webCachePrefix + 'role-rules'

const DEFAULT_ROLE_RULES = {
    [ROLE.SPECIAL]: {
        dailyCommandLimit: 0,
        hourlyCommandLimit: 0,
        dailyDeckScreenshotLimit: 30,
        attachmentLimit: 10,
    },
    [ROLE.STANDARD]: {
        dailyCommandLimit: 0,
        hourlyCommandLimit: 0,
        dailyDeckScreenshotLimit: 10,
        attachmentLimit: parseInt(process.env.LIMIT, 10) || 5,
    },
    [ROLE.PRISONER]: {
        dailyCommandLimit: 5,
        hourlyCommandLimit: 5,
        dailyDeckScreenshotLimit: 1,
        attachmentLimit: parseInt(process.env.LIMIT, 10) || 5,
    },
}

function normalizeRole(role) {
    return role || ROLE.STANDARD
}

function roleToDbValue(role) {
    return normalizeRole(role) === ROLE.STANDARD ? null : normalizeRole(role)
}

function roleLabel(role) {
    const normalized = normalizeRole(role)
    const option = ROLE_OPTIONS.find(item => item.value === normalized)
    return option ? option.label : 'Standard'
}

function isManagerRole(role) {
    return MANAGER_ROLES.has(normalizeRole(role))
}

function isGod(user) {
    return normalizeRole(user && user.role) === ROLE.GOD
}

function isVip(user) {
    return normalizeRole(user && user.role) === ROLE.VIP
}

function canAssignRole(actor, target, role) {
    const targetRole = normalizeRole(target && target.role)
    const nextRole = normalizeRole(role)

    if (!actor || !target || !KNOWN_ROLES.has(nextRole)) return false
    const actorDiscordId = actor.discordId || actor.id
    if (actorDiscordId && actorDiscordId === target.discordId && nextRole !== targetRole) return false
    if (isGod(actor)) return true
    if (!isVip(actor)) return false

    return [ROLE.STANDARD, ROLE.PRISONER].includes(targetRole) &&
        [ROLE.STANDARD, ROLE.PRISONER].includes(nextRole)
}

function assignableRoleOptions(actor, target) {
    return ROLE_OPTIONS.filter(option => canAssignRole(actor, target, option.value))
}

function sanitizeLimit(value) {
    const number = parseInt(value, 10)
    if (!Number.isInteger(number) || number < 0) return 0
    return Math.min(number, 100000)
}

function normalizeRuleSet(rules = {}) {
    const normalized = {}

    for (const role of EDITABLE_RULE_ROLES) {
        const defaults = DEFAULT_ROLE_RULES[role]
        const incoming = rules[role] || {}
        normalized[role] = {
            dailyCommandLimit: sanitizeLimit(
                incoming.dailyCommandLimit ?? defaults.dailyCommandLimit),
            hourlyCommandLimit: sanitizeLimit(
                incoming.hourlyCommandLimit ?? defaults.hourlyCommandLimit),
            dailyDeckScreenshotLimit: sanitizeLimit(
                incoming.dailyDeckScreenshotLimit ?? defaults.dailyDeckScreenshotLimit),
            attachmentLimit: sanitizeLimit(
                incoming.attachmentLimit ?? defaults.attachmentLimit),
        }
    }

    return normalized
}

async function getRoleRules() {
    const saved = await redis.json.get(roleRulesCacheKey, '$')
    return normalizeRuleSet(saved || DEFAULT_ROLE_RULES)
}

async function saveRoleRules(rules) {
    const normalized = normalizeRuleSet(rules)
    await redis.json.set(roleRulesCacheKey, '$', normalized)
    return normalized
}

function limitExceeded(limit, count) {
    return limit > 0 && count > limit
}

async function incrementLimitedCounter(redisClient, key, expirationSeconds) {
    const count = await redisClient.incr(key)
    if (count === 1) await redisClient.expire(key, expirationSeconds)
    return count
}

function buildLimitMessage(reason, limit) {
    if (reason === 'dailyCommandLimit') {
        return `Daily command limit reached (${limit}).`
    }
    if (reason === 'hourlyCommandLimit') {
        return `Hourly command rate limit reached (${limit}).`
    }
    if (reason === 'dailyDeckScreenshotLimit') {
        return `Daily deck screenshot limit reached (${limit}).`
    }
    return 'Command limit reached.'
}

async function checkRoleCommandLimit(ctx) {
    const rules = await getRoleRules()
    const role = normalizeRole(ctx.user && ctx.user.role)
    const rule = rules[role]
    if (!rule || isManagerRole(role)) return {allowed: true, rule}

    const userId = ctx.user.discordId || ctx.user.id
    const dailyKey = discordCachePrefix + `limits:${userId}:commands:daily`
    const hourlyKey = discordCachePrefix + `limits:${userId}:commands:hourly`

    const dailyCount = await incrementLimitedCounter(ctx.redis, dailyKey, 24 * 60 * 60)
    if (limitExceeded(rule.dailyCommandLimit, dailyCount)) {
        return {
            allowed: false,
            reason: 'dailyCommandLimit',
            limit: rule.dailyCommandLimit,
            message: buildLimitMessage('dailyCommandLimit', rule.dailyCommandLimit),
        }
    }

    const hourlyCount = await incrementLimitedCounter(ctx.redis, hourlyKey, 60 * 60)
    if (limitExceeded(rule.hourlyCommandLimit, hourlyCount)) {
        return {
            allowed: false,
            reason: 'hourlyCommandLimit',
            limit: rule.hourlyCommandLimit,
            message: buildLimitMessage('hourlyCommandLimit', rule.hourlyCommandLimit),
        }
    }

    ctx.roleRule = rule
    if (rule.attachmentLimit > 0) {
        ctx.limit = Math.min(ctx.limit, rule.attachmentLimit)
    }

    return {allowed: true, rule}
}

async function checkRoleDeckScreenshotLimit(ctx) {
    const rules = await getRoleRules()
    const role = normalizeRole(ctx.user && ctx.user.role)
    const rule = rules[role]
    if (!rule || isManagerRole(role) || !rule.dailyDeckScreenshotLimit) {
        return {allowed: true, rule}
    }

    const userId = ctx.user.discordId || ctx.user.id
    const key = discordCachePrefix + `limits:${userId}:deck-screenshots:daily`
    const count = await incrementLimitedCounter(ctx.redis, key, 24 * 60 * 60)
    if (limitExceeded(rule.dailyDeckScreenshotLimit, count)) {
        return {
            allowed: false,
            reason: 'dailyDeckScreenshotLimit',
            limit: rule.dailyDeckScreenshotLimit,
            message: buildLimitMessage(
                'dailyDeckScreenshotLimit',
                rule.dailyDeckScreenshotLimit),
        }
    }

    return {allowed: true, rule}
}

module.exports = {
    ROLE,
    ROLE_OPTIONS,
    EDITABLE_RULE_ROLES,
    DEFAULT_ROLE_RULES,
    normalizeRole,
    roleToDbValue,
    roleLabel,
    isGod,
    canAssignRole,
    assignableRoleOptions,
    normalizeRuleSet,
    getRoleRules,
    saveRoleRules,
    checkRoleCommandLimit,
    checkRoleDeckScreenshotLimit,
}
