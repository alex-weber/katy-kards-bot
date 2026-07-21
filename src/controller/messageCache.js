const {PermissionsBitField} = require('discord.js')
const {translate} = require('../tools/translation/translator')

//cache key prefix is namespaced by environment
const cacheKeyPrefix = process.env.NODE_ENV === 'production'
    ? 'discord:prod:'
    : 'discord:dev:'

//Discord error codes for which a forward is expected to fail and the caller
//simply regenerates the answer. These are benign (a permission/channel state
//we recover from), so they are logged quietly rather than as errors.
//The cache is per-guild, so a cached message may live in a channel the bot can
//no longer access (deleted/permissions revoked) -> Missing Access on fetch.
const recoverableForwardErrors = new Set([
    10003, //Unknown Channel  (cached channel was deleted)
    10008, //Unknown Message  (cached message was deleted)
    50001, //Missing Access   (lost access to the source channel)
    50013, //Missing Permissions
    160009, //Cannot reference a message without read message history
])

/**
 *
 * @param message
 * @returns {string}
 */
function getGuildPart(message)
{
    if (message.guildId) {
        return 'guild:' + message.guildId.toString() + ':'
    }

    return 'user_command:' + message.author.id.toString() + ':'
}

/**
 * Whether the bot may post a message that references another message in this
 * channel. Forwarding references the original message, which Discord only
 * permits with the Read Message History permission; without it the forward is
 * rejected with error 160009. Checked live (permissionsFor is a local lookup,
 * no API call) so a permission change takes effect immediately, and per channel
 * so each server is handled independently. DM channels have no permission
 * system (permissionsFor returns null) and are always allowed.
 *
 * @param client
 * @param channel the channel the forward would be posted into
 * @returns {boolean}
 */
function canForwardInto(client, channel)
{
    const permissions = channel.permissionsFor(client.user.id)
    if (!permissions) return true //DM channel

    return permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
}

/**
 * Replay a cached message by forwarding it into the requesting message's
 * channel. Returns false (rather than throwing) when the forward cannot
 * happen — most commonly because the bot lacks Read Message History on this
 * server's channel — so the caller can fall back to regenerating the answer
 * with a fresh send.
 *
 * A forwarded message can't carry the usual "Requested by/from" attribution
 * line (Discord rejects any `content` on a forward with API error 160011), so
 * for slash commands a small notice is posted as its own message right before
 * the forward — otherwise a cache hit would be a public channel message with
 * no visible origin at all. Legacy `!` commands skip this: the user's own
 * message is already visible right above, so there's nothing to add.
 *
 * @param client
 * @param cachedData
 * @param message the invoking message/interaction wrapper — its `.channel` is
 *   the forward target, and (for slash commands) its `.isSlash`/`.author`/
 *   `.channel.sendRaw` drive the pre-forward notice
 * @param notice {language, query, key} for the pre-forward notice; `key`
 *   defaults to the generic 'cacheRequestNotice' translation key
 * @returns {Promise<boolean>} true when the message was forwarded
 */
async function forwardCachedMessage(client, cachedData, message, notice = {})
{
    const {language, query, key = 'cacheRequestNotice'} = notice
    if (!cachedData || !cachedData.id) return false
    if (!canForwardInto(client, message.channel)) {
        console.log('no Read Message History permission, skipping forward')

        return false
    }
    try {
        let channel
        if (cachedData.guildId && cachedData.channelId) {
            const guild = await client.guilds.fetch(cachedData.guildId)
            channel = await guild.channels.fetch(cachedData.channelId)
        } else {
            channel = await client.channels.fetch(
                cachedData.channelId || message.channelId)
        }
        const messageToForward = await channel.messages.fetch(cachedData.id)
        if (!messageToForward) return false

        if (message.isSlash) {
            await message.channel.sendRaw(translate(language, key, {
                name: message.author.username,
                query,
            }))
        }
        await messageToForward.forward(message.channel)

        return true
    } catch (e) {
        //expected forward failures: log quietly, the caller will regenerate
        if (recoverableForwardErrors.has(e.code)) {
            console.log(
                'cannot forward cached message, regenerating:', e.code, e.message)
        } else {
            console.error('Error fetching message from cache:', e)
        }

        return false
    }
}

/**
 * Store a sent message reference in cache so it can be forwarded later.
 *
 * @param redis
 * @param key
 * @param sentMessage
 * @param ttl
 * @param extra optional extra fields to merge into the cached entry
 * @returns {Promise<void>}
 */
async function cacheSentMessage(redis, key, sentMessage, ttl, extra = {})
{
    await redis.json.set(key, '$', {
        id: sentMessage.id,
        channelId: sentMessage.channelId,
        guildId: sentMessage.guildId,
        ...extra,
    })
    await redis.expire(key, ttl)
}

module.exports = {
    cacheKeyPrefix,
    getGuildPart,
    forwardCachedMessage,
    cacheSentMessage,
}
