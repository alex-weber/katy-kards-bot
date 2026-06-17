const {redis, cachePrefix: webCachePrefix} = require('../controller/redis')
const {cacheKeyPrefix: discordCachePrefix} = require('../controller/messageCache')
const {translate} = require('./translation/translator')

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
const DAILY_LIMIT_WINDOW_SECONDS = 24 * 60 * 60
const HOURLY_LIMIT_WINDOW_SECONDS = 60 * 60

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

function unwrapJsonPathResult(value) {
    return Array.isArray(value) && value.length === 1 ? value[0] : value
}

function normalizeRuleSet(rules = {}) {
    rules = unwrapJsonPathResult(rules) || {}
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

async function setOnce(redisClient, key, expirationSeconds) {
    if (await redisClient.exists(key)) return false
    await redisClient.set(key, '1')
    await redisClient.expire(key, expirationSeconds)
    return true
}

async function getResetInfo(redisClient, key, fallbackSeconds) {
    const ttl = typeof redisClient.ttl === 'function'
        ? await redisClient.ttl(key)
        : fallbackSeconds
    const secondsUntilReset = ttl > 0 ? ttl : fallbackSeconds
    return {
        secondsUntilReset,
        timestamp: Math.floor(Date.now() / 1000) + secondsUntilReset,
    }
}

function formatRelativeReset(resetTimestamp) {
    return `<t:${resetTimestamp}:R>`
}

function buildPrisonerWarningMessage(language, limit, resetTimestamp) {
    return translate(language, 'prisonerLimitWarning', {
        limit,
        reset: formatRelativeReset(resetTimestamp),
    })
}

function buildLimitMessage(language, reason, limit, resetTimestamp) {
    const reset = resetTimestamp ? formatRelativeReset(resetTimestamp) : ''

    if (reason === 'dailyCommandLimit') {
        return translate(language, 'dailyCommandLimitReached', {limit, reset})
    }
    if (reason === 'hourlyCommandLimit') {
        return translate(language, 'hourlyCommandLimitReached', {limit, reset})
    }
    if (reason === 'dailyDeckScreenshotLimit') {
        return translate(language, 'dailyDeckScreenshotLimitReached', {limit, reset})
    }
    return translate(language, 'commandLimitReached', {limit, reset})
}

async function checkRoleCommandLimit(ctx) {
    const rules = await getRoleRules()
    const role = normalizeRole(ctx.user && ctx.user.role)
    const rule = rules[role]
    if (!rule || isManagerRole(role)) return {allowed: true, rule}
    const language = ctx.language || (ctx.user && ctx.user.language) || 'en'

    const userId = ctx.user.discordId || ctx.user.id
    const dailyKey = discordCachePrefix + `limits:${userId}:commands:daily`
    const dailyWarningKey = dailyKey + ':warning'
    const dailyBlockedWarningKey = dailyKey + ':blocked-warning'
    const hourlyKey = discordCachePrefix + `limits:${userId}:commands:hourly`
    const hasDailyLimit = rule.dailyCommandLimit > 0
    const hasHourlyLimit = rule.hourlyCommandLimit > 0

    if (role === ROLE.PRISONER && hasDailyLimit &&
        await ctx.redis.exists(dailyBlockedWarningKey)) {
        return {
            allowed: false,
            reason: 'dailyCommandLimit',
            limit: rule.dailyCommandLimit,
            silent: true,
        }
    }

    let warningMessage = null
    if (hasDailyLimit) {
        const dailyCount = await incrementLimitedCounter(
            ctx.redis,
            dailyKey,
            DAILY_LIMIT_WINDOW_SECONDS)
        const reset = await getResetInfo(
            ctx.redis,
            dailyKey,
            DAILY_LIMIT_WINDOW_SECONDS)

        if (role === ROLE.PRISONER && dailyCount === 1) {
            const shouldWarn = await setOnce(
                ctx.redis,
                dailyWarningKey,
                reset.secondsUntilReset)
            if (shouldWarn) {
                warningMessage = buildPrisonerWarningMessage(
                    language,
                    rule.dailyCommandLimit,
                    reset.timestamp)
            }
        }

        if (limitExceeded(rule.dailyCommandLimit, dailyCount)) {
            const shouldWarn = role !== ROLE.PRISONER ||
                await setOnce(
                    ctx.redis,
                    dailyBlockedWarningKey,
                    reset.secondsUntilReset)

            return {
                allowed: false,
                reason: 'dailyCommandLimit',
                limit: rule.dailyCommandLimit,
                silent: !shouldWarn,
                message: shouldWarn
                    ? buildLimitMessage(
                        language,
                        'dailyCommandLimit',
                        rule.dailyCommandLimit,
                        reset.timestamp)
                    : null,
            }
        }
    }

    if (hasHourlyLimit) {
        const hourlyCount = await incrementLimitedCounter(
            ctx.redis,
            hourlyKey,
            HOURLY_LIMIT_WINDOW_SECONDS)
        if (limitExceeded(rule.hourlyCommandLimit, hourlyCount)) {
            return {
                allowed: false,
                reason: 'hourlyCommandLimit',
                limit: rule.hourlyCommandLimit,
                message: buildLimitMessage(
                    language,
                    'hourlyCommandLimit',
                    rule.hourlyCommandLimit),
            }
        }
    }

    ctx.roleRule = rule
    if (rule.attachmentLimit > 0) {
        ctx.limit = Math.min(ctx.limit, rule.attachmentLimit)
    }

    return {allowed: true, rule, message: warningMessage}
}

async function checkRoleDeckScreenshotLimit(ctx) {
    const rules = await getRoleRules()
    const role = normalizeRole(ctx.user && ctx.user.role)
    const rule = rules[role]
    if (!rule || isManagerRole(role) || !rule.dailyDeckScreenshotLimit) {
        return {allowed: true, rule}
    }
    const language = ctx.language || (ctx.user && ctx.user.language) || 'en'

    const userId = ctx.user.discordId || ctx.user.id
    const key = discordCachePrefix + `limits:${userId}:deck-screenshots:daily`
    const count = await incrementLimitedCounter(ctx.redis, key, DAILY_LIMIT_WINDOW_SECONDS)
    if (limitExceeded(rule.dailyDeckScreenshotLimit, count)) {
        const reset = await getResetInfo(
            ctx.redis,
            key,
            DAILY_LIMIT_WINDOW_SECONDS)
        return {
            allowed: false,
            reason: 'dailyDeckScreenshotLimit',
            limit: rule.dailyDeckScreenshotLimit,
            message: buildLimitMessage(
                language,
                'dailyDeckScreenshotLimit',
                rule.dailyDeckScreenshotLimit,
                reset.timestamp),
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
