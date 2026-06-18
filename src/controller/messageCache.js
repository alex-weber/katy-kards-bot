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
 *
 * @param client
 * @param cachedData
 * @param targetChannel
 * @param fallbackChannelId
 * @returns {Promise<void>}
 */
async function forwardCachedMessage(
    client, cachedData, targetChannel, fallbackChannelId)
{
    if (!cachedData || !cachedData.id) return
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
        if (messageToForward) {
            await messageToForward.forward(targetChannel)
        }
    } catch (e) {
        console.error('Error fetching message from cache:', e)
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
