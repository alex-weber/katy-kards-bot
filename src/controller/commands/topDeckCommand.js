const {cacheKeyPrefix} = require("../messageCache")
const {isBotCommandChannel} = require("../../tools/search")
const {handleTD} = require("../../games/topDeckController")

//wait this long (ms) between TD commands from the same user
const slowModeInterval =
    parseInt(process.env.SLOW_MODE_INTERVAL) || 5000

/**
 * Run the top-deck game (only in dedicated bot-command channels).
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleTopDeck(ctx)
{
    const {message, redis, user, command} = ctx
    if (!command.startsWith('td') || !message.guildId ||
        !isBotCommandChannel(message)) return false

    // TD command spam protection.
    // The "next" command is allowed only after slowModeInterval passes.
    const userTDKey = cacheKeyPrefix + 'td:' + user.id
    const unblockTime = await redis.get(userTDKey)
    if (Date.now() < unblockTime) return true //not allowed, do nothing

    const userKey = cacheKeyPrefix + 'user:' + message.author.id.toString()
    await redis.del(userKey)
    redis.set(userTDKey, Date.now() + slowModeInterval)
    await handleTD(user, command, message)

    return true
}

module.exports = {
    handleTopDeck,
}
