const {redis, cachePrefix: webCachePrefix} = require('../controller/redis')

// Per-guild overrides for the attachment limits that are otherwise fixed at
// 5 (normal channels) and 10 (bot-command channels). Only GOD users edit these
// from the servers page; everything falls back to the defaults below when a
// guild has no saved override, so existing guilds behave exactly as before.
const guildSettingsCacheKey = webCachePrefix + 'guild-settings'

// Discord and Telegram both reject a message carrying more than 10 attachments,
// so neither limit may exceed this — larger input is clamped down.
const MAX_ATTACHMENTS = 10

// The historical hardcoded values. `channelAttachmentLimit` mirrors the old
// `process.env.LIMIT || 5`; `botChannelAttachmentLimit` mirrors the old
// paginationLimit constant (10), which also drives the pagination page size
// and cache threshold — see discordHandler.
const DEFAULT_GUILD_SETTINGS = {
    channelAttachmentLimit: Math.min(parseInt(process.env.LIMIT, 10) || 5, MAX_ATTACHMENTS),
    botChannelAttachmentLimit: MAX_ATTACHMENTS,
}

// redis.json.get with '$' returns a one-element array wrapping the value; older
// writes may return it unwrapped, so accept both (mirrors tools/roles.js).
function unwrapJsonPathResult(value) {
    return Array.isArray(value) && value.length === 1 ? value[0] : value
}

// Attachment limits must be at least 1 — a 0 would silently post nothing. Empty
// or invalid input falls back to the supplied default rather than clamping to a
// surprising value; anything above the platform cap is clamped down to it.
function sanitizeLimit(value, fallback) {
    const number = parseInt(value, 10)
    if (!Number.isInteger(number) || number < 1) return fallback
    return Math.min(number, MAX_ATTACHMENTS)
}

function normalizeSettings(settings) {
    return {
        channelAttachmentLimit: sanitizeLimit(
            settings.channelAttachmentLimit,
            DEFAULT_GUILD_SETTINGS.channelAttachmentLimit),
        botChannelAttachmentLimit: sanitizeLimit(
            settings.botChannelAttachmentLimit,
            DEFAULT_GUILD_SETTINGS.botChannelAttachmentLimit),
    }
}

// The whole `{ [guildId]: settings }` map, each entry normalized. Guilds with no
// saved override are simply absent — callers fall back to the defaults.
async function getGuildSettings() {
    const saved = unwrapJsonPathResult(await redis.json.get(guildSettingsCacheKey, '$')) || {}
    const normalized = {}
    for (const [guildId, settings] of Object.entries(saved)) {
        normalized[guildId] = normalizeSettings(settings || {})
    }
    return normalized
}

async function saveGuildSettings(settingsByGuild) {
    const normalized = {}
    for (const [guildId, settings] of Object.entries(settingsByGuild || {})) {
        normalized[guildId] = normalizeSettings(settings || {})
    }
    await redis.json.set(guildSettingsCacheKey, '$', normalized)
    return normalized
}

// The effective limits for one guild: its saved override, or the defaults. Used
// by the message handler on every command, so it reads the map once per call.
async function resolveGuildLimits(guildId) {
    if (!guildId) return {...DEFAULT_GUILD_SETTINGS}
    const all = await getGuildSettings()
    return all[String(guildId)] || {...DEFAULT_GUILD_SETTINGS}
}

module.exports = {
    MAX_ATTACHMENTS,
    DEFAULT_GUILD_SETTINGS,
    getGuildSettings,
    saveGuildSettings,
    resolveGuildLimits,
    sanitizeLimit,
}
