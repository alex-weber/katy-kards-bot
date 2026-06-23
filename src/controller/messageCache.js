const {PermissionsBitField} = require('discord.js')

//cache key prefix is namespaced by environment
const cacheKeyPrefix = process.env.NODE_ENV === 'production'
    ? 'discord:prod:'
    : 'discord:dev:'

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
 * Replay a cached message by forwarding it into the target channel. Returns
 * false (rather than throwing) when the forward cannot happen — most commonly
 * because the bot lacks Read Message History on this server's channel — so the
 * caller can fall back to regenerating the answer with a fresh send.
 *
 * @param client
 * @param cachedData
 * @param targetChannel
 * @param fallbackChannelId
 * @returns {Promise<boolean>} true when the message was forwarded
 */
async function forwardCachedMessage(
    client, cachedData, targetChannel, fallbackChannelId)
{
    if (!cachedData || !cachedData.id) return false
    if (!canForwardInto(client, targetChannel)) {
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
                cachedData.channelId || fallbackChannelId)
        }
        const messageToForward = await channel.messages.fetch(cachedData.id)
        if (!messageToForward) return false
        await messageToForward.forward(targetChannel)

        return true
    } catch (e) {
        console.error('Error fetching message from cache:', e)

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
