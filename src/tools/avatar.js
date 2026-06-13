/**
 * Resolve a Discord user's avatar URL via the gateway client. discord.js
 * caches the user after the first lookup, so repeated profile views are cheap.
 *
 * Returns the user's custom avatar (or Discord's default avatar) when the id
 * belongs to a reachable Discord user, otherwise null — e.g. Telegram-only
 * users whose stored id is not a Discord snowflake — so the caller can fall
 * back to a placeholder.
 *
 * @param client discord.js Client (may be undefined, e.g. in tests)
 * @param discordId Discord user snowflake
 * @returns {Promise<string|null>}
 */
async function resolveAvatarUrl(client, discordId)
{
    if (!client || !discordId) return null

    try {
        const user = await client.users.fetch(discordId)
        return user.displayAvatarURL({ extension: 'webp', size: 128 })
    } catch {
        // Unknown / non-Discord user — let the caller show a placeholder.
        return null
    }
}

module.exports = { resolveAvatarUrl }
