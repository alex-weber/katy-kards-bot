const bot = require("./bot")
const {createMessage} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {isBotCommandChannel} = require("../tools/search")
const {logMemoryUsage} = require("../tools/memoryLoger")
const {
    resolveButtonCommand,
    loadUser,
    checkUserStatus,
    ensureUserName,
    resolveLanguage,
} = require("./messageContext")
const {
    handleMidnight,
    handleUtc,
    handleStats,
    handleDm,
    handleLanguageSwitch,
    handleHelp,
    handleSync,
    handleRanking,
    handleMyRank,
    handleProfile,
    handleServers,
} = require("./commands/infoCommands")
const {handleDeck, handleAlt} = require("./commands/deckCommands")
const {
    handleManageSynonym,
    handleListCommands,
    resolveSynonym,
} = require("./commands/synonymCommands")
const {handleTopDeck} = require("./commands/topDeckCommand")
const {handleSearch} = require("./commands/searchCommand")
const {checkRoleCommandLimit} = require("../tools/roles")

const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
//buffer overflow protection :)
const maxStrLen = parseInt(process.env.MAX_STR_LEN) || 4000
//load more results button limit
const paginationLimit = 10

/**
 * Confirm the bot may write in this channel (always true in DMs).
 *
 * @param client
 * @param message
 * @param redis
 * @returns {Promise<boolean>}
 */
async function checkWritePermissions(client, message, redis)
{
    console.time('permissions')
    const permitted = await bot.hasWritePermissions(client, message, redis)
    console.timeEnd('permissions')

    return !message.guildId || permitted
}

/**
 * Log the incoming command and capture the guild/channel names.
 *
 * @param message
 * @returns {{guildName: string, channelName: string}}
 */
function logCommand(message)
{
    let guildName = ''
    let channelName = 'DM'
    if (message.guildId) {
        guildName = message.guild.name
        channelName = message.channel.name
    }
    console.log('bot command:', guildName, channelName,
        message.author.username, '->', message.content)
    logMemoryUsage()

    return {guildName, channelName}
}

/**
 * Resolve incoming content into a clean command string, or signal a stop.
 *
 * @param message
 * @param prefix
 * @returns {{command?: string, qSearch: *, stop?: boolean}}
 */
function resolveCommandText(message, prefix)
{
    //is there a "bot command" marked with double quotation marks?
    const qSearch = bot.isQuotationSearch(message)
    if (qSearch) {
        //rewrite the message content with only necessary information
        console.log('bot command with quotes inside a message:',
            message.content)
        message.content = qSearch
    } else if (!message.content.startsWith(prefix)) {
        //not a bot command or bot
        return {qSearch, stop: true}
    }

    //remove all the prefixes from the beginning
    const command = bot.parseCommand(prefix, message.content)

    return {command, qSearch}
}

/**
 *
 * @param message
 * @param client
 * @param redis
 * @returns {Promise<*>}
 */
async function discordHandler(message, client, redis)
{
    //get a custom server prefix if set
    const prefix = bot.getPrefix(message)

    const button = await resolveButtonCommand(message, redis, prefix)
    if (button.stop) return message

    if (message.author.bot || message.content.length > maxStrLen)
        return message

    const text = resolveCommandText(message, prefix)
    if (text.stop) return message

    //check for WRITE permissions
    if (!await checkWritePermissions(client, message, redis)) return message

    //it's a bot command
    const {guildName, channelName} = logCommand(message)

    //return if the message is empty
    if (!text.command.length) return message

    const ctx = {
        message, client, redis, prefix,
        qSearch: text.qSearch,
        command: text.command,
        language: undefined,
        user: undefined,
        guildName, channelName,
        cmdCacheKey: button.cmdCacheKey,
        limit: globalLimit,
        paginationLimit,
    }

    //time commands need no user context
    if (await handleMidnight(ctx)) return message
    if (await handleUtc(ctx)) return message

    //set up the user
    ctx.user = await loadUser(message, redis)
    if (checkUserStatus(ctx.user, message)) return message
    await ensureUserName(ctx.user, message)
    ctx.language = await resolveLanguage(ctx)

    const roleLimit = await checkRoleCommandLimit(ctx)
    if (!roleLimit.allowed) {
        if (!roleLimit.silent && roleLimit.message) {
            await message.channel.send(roleLimit.message)
        }
        return message
    }
    if (roleLimit.message) await message.channel.send(roleLimit.message)

    //save the command in the DB and in cache, no need to wait
    const fullContent = `${guildName} | ${channelName} -> ${ctx.command}`
    createMessage({authorId: ctx.user.id, content: fullContent}).then()

    if (await handleDeck(ctx)) return message
    if (await handleStats(ctx)) return message
    if (await handleDm(ctx)) return message
    if (await handleLanguageSwitch(ctx)) return message
    if (await handleHelp(ctx)) return message
    if (handleSync(ctx)) return message
    if (await handleRanking(ctx)) return message
    if (await handleMyRank(ctx)) return message
    if (await handleProfile(ctx)) return message
    if (await handleTopDeck(ctx)) return message

    //check minimums
    if (ctx.command.length < minStrLen && !ctx.qSearch)
        return message.channel.send(translate(ctx.language, 'min'))

    if (await handleServers(ctx)) return message
    if (await handleListCommands(ctx)) return message
    if (await handleManageSynonym(ctx)) return message
    //resolveSynonym may rewrite ctx.command and fall through to search
    if (await resolveSynonym(ctx)) return message

    //set the limit to 10 if it is a bot-commands channel
    if (isBotCommandChannel(message)) ctx.limit = paginationLimit
    if (ctx.roleRule && ctx.roleRule.attachmentLimit > 0) {
        ctx.limit = Math.min(ctx.limit, ctx.roleRule.attachmentLimit)
    }

    if (await handleAlt(ctx)) return message

    await handleSearch(ctx)

    return message
}

module.exports = {discordHandler}
