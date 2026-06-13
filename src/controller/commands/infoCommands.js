const bot = require("../bot")
const {cacheKeyPrefix} = require("../messageCache")
const {getTopDeckStats} = require("../../database/db")
const {translate} = require("../../tools/translation/translator")
const {getStats, getServerList} = require("../../tools/stats")
const {myTDRank} = require("../../games/topDeck")
const {isManager} = require("../../tools/search")

//refresh window for the cached user record
const userExp = process.env.REDIS_EXP_USER || 60 * 60 * 24 * 7 // 7 days

/**
 * Reply with a relative timer to the next day 00:00 UTC.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleMidnight(ctx)
{
    if (ctx.command !== 'midnight') return false

    const midnight = bot.getMidnight().toString()
    const sentMessage =
        await ctx.message.channel.send('<t:' + midnight + ':R>')
    sentMessage.react('🕛')

    return true
}

/**
 * Reply with the current UTC time.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleUtc(ctx)
{
    if (ctx.command !== 'utc') return false

    await ctx.message.channel.send(bot.getUTC())

    return true
}

/**
 * Reply with the online/in-game stats.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleStats(ctx)
{
    if (ctx.command !== 'ingame' && ctx.command !== 'online') return false

    const stats = await getStats(ctx.language)
    await ctx.message.channel.send(stats)

    return true
}

/**
 * Open a DM channel for the user.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleDm(ctx)
{
    if (ctx.command !== 'dm') return false

    console.log('creating DM...')
    await ctx.message.author.createDM()
    await ctx.message.channel.send(translate(ctx.language, 'dm'))

    return true
}

/**
 * Switch the user's language.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleLanguageSwitch(ctx)
{
    const {message, redis, user, command, qSearch} = ctx
    if (!bot.isLanguageSwitch(command) || qSearch) return false

    const language = await bot.switchLanguage(user, command)
    user.language = language
    const userId = message.author.id.toString()
    const userKey = cacheKeyPrefix + 'user:' + userId
    await redis.json.set(userKey, '$.language', language)
    await redis.expire(userKey, userExp) //refresh expiration
    await message.channel.send(
        translate(language, 'langChange') + language.toUpperCase())

    return true
}

/**
 * Reply with the help text.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleHelp(ctx)
{
    if (ctx.command !== 'help') return false

    await ctx.message.channel.send(
        '```' + translate(ctx.language, 'help') + '```')

    return true
}

/**
 * Spawn a DB sync with kards.com (managers only).
 *
 * @param ctx
 * @returns {boolean}
 */
function handleSync(ctx)
{
    const {message, user} = ctx
    if (ctx.command !== 'sync' || !isManager(user)) return false

    const spawn = require('child_process').spawn
    const child = spawn('node', ['src/tools/sync.js'],
        {stdio: ['inherit', 'inherit', 'inherit', 'ipc']})
    message.channel.send('starting DB sync with kards.com...')
    const startTime = Date.now()
    console.time('db_sync')
    child.on('close', function(code)
    {
        console.timeEnd('db_sync')
        const endTime = Date.now()
        const duration = ((endTime - startTime) / 1000).toFixed(3)
        if (code === 0)
            return message.channel.send('DB sync done in ' + duration + 's')
    })
    child.on('message', m => message.channel.send(m))
    child.on('error', function(error)
    {
        console.log(error)
        console.timeEnd('db_sync')
        return message.channel.send('DB sync error. Check log for details.')
    })

    return true
}

/**
 * Reply with the top 9 TD ranking.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleRanking(ctx)
{
    if (!ctx.command.startsWith('ranking')) return false

    await ctx.message.channel.send(await getTopDeckStats())

    return true
}

/**
 * Reply with the user's own TD ranking.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleMyRank(ctx)
{
    if (ctx.command !== 'myrank') return false

    await ctx.message.channel.send(myTDRank(ctx.user))

    return true
}

/**
 * Reply with the server list (managers only).
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleServers(ctx)
{
    const {command, user, client, message} = ctx
    if (!command.startsWith('servers') || !isManager(user)) return false

    await message.channel.send(getServerList(client).map(
        (item, index) => `${index + 1}. ${item[1]}`).join('\n'))

    return true
}

module.exports = {
    handleMidnight,
    handleUtc,
    handleStats,
    handleDm,
    handleLanguageSwitch,
    handleHelp,
    handleSync,
    handleRanking,
    handleMyRank,
    handleServers,
}
