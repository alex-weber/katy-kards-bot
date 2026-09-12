const bot = require("./bot")
const {createMessage} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {isBotCommandChannel} = require("../tools/search")
const {resolveGuildLimits} = require("../tools/guildSettings")
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
    handleContact,
    handleLanguageSwitch,
    handleHelp,
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
const {
    handleTerms,
    handleTermsGate,
} = require("./commands/termsCommands")
const {checkRoleCommandLimit} = require("../tools/roles")

const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
//buffer overflow protection :)
const maxStrLen = parseInt(process.env.MAX_STR_LEN) || 4000
//attachment limits (normal-channel + bot-channel) are resolved per guild from
//guildSettings, defaulting to 5 / 10 — see resolveGuildLimits below

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
    const permitted = await bot.hasWritePermissions(client, message, redis)

    return !message.guildId || permitted
}

/**
 * Resolve the guild/channel names used for context and the command summary
 * line (DM when not in a guild).
 *
 * This no longer prints a generic "<source> received: … -> …" line. Search —
 * the dominant command, on every entry path (slash / text / "Next" button) —
 * now emits its own richer summary (source, user, channel, query, cache HIT
 * /MISS, page, timings), which that line only duplicated: the user's exact
 * "the first one looks obsolete" case. Other commands reply visibly to the
 * user, and every command is still recorded in the DB audit (createMessage
 * below), so nothing is lost by dropping the console echo.
 *
 * @param message
 * @returns {{guildName: string, channelName: string}}
 */
function resolveGuildChannel(message)
{
    let guildName = ''
    let channelName = 'DM'
    if (message.guildId) {
        guildName = message.guild.name
        channelName = message.channel.name
    }

    return {guildName, channelName}
}

/**
 * Resolve incoming content into a clean command string or signal a stop.
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

    //check for WRITE permissions (timed, folded into the command summary line)
    const permStarted = Date.now()
    const permitted = await checkWritePermissions(client, message, redis)
    const permMs = Date.now() - permStarted
    if (!permitted) return message

    //it's a bot command
    const {guildName, channelName} = resolveGuildChannel(message)

    //return if the message is empty
    if (!text.command.length) return message

    //per-guild attachment limits (GOD-configurable on the servers page); falls
    //back to the historical 5 / 10 defaults for DMs and unconfigured guilds. The
    //bot-channel limit doubles as the pagination page size and cache threshold.
    const guildLimits = await resolveGuildLimits(message.guildId)

    const ctx = {
        message, client, redis, prefix,
        qSearch: text.qSearch,
        command: text.command,
        language: undefined,
        user: undefined,
        guildName, channelName,
        cmdCacheKey: button.cmdCacheKey,
        limit: guildLimits.channelAttachmentLimit,
        paginationLimit: guildLimits.botChannelAttachmentLimit,
        //per-step latencies, folded into the single command summary line by
        //the search handler; getCards() fills in api/db, this handler perm/usr
        timings: {perm: permMs},
    }

    //time commands need no user context
    if (await handleMidnight(ctx)) return message
    if (await handleUtc(ctx)) return message

    //set up the user
    const userStarted = Date.now()
    ctx.user = await loadUser(message, redis)
    ctx.timings.usr = Date.now() - userStarted
    if (checkUserStatus(ctx.user, message)) return message
    await ensureUserName(ctx.user, message)
    ctx.language = await resolveLanguage(ctx)

    //users who have not accepted the terms only get the terms prompt (except
    //for the privacy/terms commands, which fall through below)
    if (await handleTermsGate(ctx)) return message

    const roleLimit = await checkRoleCommandLimit(ctx)
    if (!roleLimit.allowed) {
        if (!roleLimit.silent && roleLimit.message) {
            message.channel.send(roleLimit.message)
        }
        return message
    }
    if (roleLimit.message) message.channel.send(roleLimit.message)

    //save the command in the DB and in cache, no need to wait. Deck codes are
    //trimmed to just the code so the whole message is not stored.
    const storedCommand = bot.getLoggableCommand(ctx.command, message.content)
    const fullContent = `${guildName} | ${channelName} -> ${storedCommand}`
    createMessage({authorId: ctx.user.id, content: fullContent}).then()

    if (await handleTerms(ctx)) return message
    if (await handleDeck(ctx)) return message
    if (await handleStats(ctx)) return message
    if (await handleDm(ctx)) return message
    if (await handleContact(ctx)) return message
    if (await handleLanguageSwitch(ctx)) return message
    if (await handleHelp(ctx)) return message
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

    //raise the limit to the bot-channel limit if it is a bot-commands channel
    if (isBotCommandChannel(message)) ctx.limit = ctx.paginationLimit
    if (ctx.roleRule && ctx.roleRule.attachmentLimit > 0) {
        ctx.limit = Math.min(ctx.limit, ctx.roleRule.attachmentLimit)
    }

    if (await handleAlt(ctx)) return message

    await handleSearch(ctx)

    return message
}

module.exports = {discordHandler}
