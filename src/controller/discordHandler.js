const bot = require("./bot")
const {createMessage} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {defaultLanguage} = require("../tools/language")
const {cacheKeyPrefix} = require("./messageCache")
const {isBotCommandChannel} = require("../tools/search")
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

const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
//buffer overflow protection :)
const maxStrLen = parseInt(process.env.MAX_STR_LEN) || 4000
//load more results button limit
const paginationLimit = 10
//how often each user is nudged about the legacy-command deprecation (24h)
const deprecationWarnExp = parseInt(process.env.REDIS_EXP_DEPRECATION) || 60 * 60 * 24
//when text commands stop working, shown as a Discord relative timestamp in the
//nag so it counts down (and localises) per viewer. Defaults to 2 Aug 2026, 12:00 UTC
const deprecationDeadline = process.env.DEPRECATION_DEADLINE || '2026-08-02T12:00:00Z'

/**
 * Nudge users of the legacy `!` prefix commands toward slash commands. Discord
 * is removing the Message Content Intent these depend on, so text commands will
 * stop working soon. Rate-limited to once per user per day so the channel is
 * not flooded. The reminder is skipped for slash-routed commands and for the
 * bot's own pagination button presses.
 *
 * @param message
 * @param redis
 * @returns {Promise<void>}
 */
async function warnLegacyCommand(message, redis)
{
    const key = 'deprecation:warned:' + message.author.id
    //atomic check-and-set (NX): two commands from the same user racing each
    //other can't both pass a separate exists-then-set, which would send the
    //nag twice
    const firstWarning = await redis.set(key, '1', {NX: true, EX: deprecationWarnExp})
    if (!firstWarning) return

    //best-effort language from the cached user; default when not cached yet
    const userKey = cacheKeyPrefix + 'user:' + message.author.id
    const cached = await redis.json.get(userKey, '$')
    const language = (cached && cached.language) || defaultLanguage
    //Discord renders <t:unix:R> as a live, viewer-localised relative time
    //(e.g. "in 5 days"), replacing the old hard-coded "soon"
    const deadline = `<t:${Math.floor(new Date(deprecationDeadline).getTime() / 1000)}:R>`
    await message.channel.send(translate(language, 'deprecated', {deadline})).catch(() => {})
}

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

    //remind legacy prefix-command users to switch to slash commands (skip
    //slash-routed commands and pagination button presses). Only nag in guilds:
    //text commands remain a supported fallback in DMs, and with the Guild
    //Messages/Message Content intents dropped this branch is reached only by the
    //DM path anyway — so the nag stays dormant until guild text commands return.
    if (!message.isSlash && !message.buttonId && message.guildId) {
        await warnLegacyCommand(message, redis)
    }

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

    //set the limit to 10 if it is a bot-commands channel
    if (isBotCommandChannel(message)) ctx.limit = paginationLimit
    if (ctx.roleRule && ctx.roleRule.attachmentLimit > 0) {
        ctx.limit = Math.min(ctx.limit, ctx.roleRule.attachmentLimit)
    }

    if (await handleAlt(ctx)) return message

    await handleSearch(ctx)

    return message
}

module.exports = {discordHandler, warnLegacyCommand}
