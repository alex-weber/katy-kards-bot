const bot = require("../bot")
const {
    cacheKeyPrefix,
    getChannelScope,
    forwardCachedMessage,
    cacheSentMessage,
} = require("../messageCache")
const {getAllSynonyms} = require("../../database/db")
const {translate} = require("../../tools/translation/translator")
const {createDeckImages} = require("../../tools/deck")
const {getButtonRow} = require("../../tools/button")
const {isBotCommandChannel} = require("../../tools/search")
const {checkRoleDeckScreenshotLimit} = require("../../tools/roles")
const {sendPrivately} = require("../../tools/privateReply")
const {setLog, addTiming, formatPage} = require("../../tools/commandLog")

//cache lifetime (seconds)
const deckExp = process.env.REDIS_EXP_DECK || 60 * 60 * 24 * 30 // 30 days

/**
 * Render a deck link / deck code as card images.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleDeck(ctx)
{
    const {message, client, redis, prefix, language} = ctx
    if (!bot.isDeckLink(ctx.command) && !bot.isDeckCode(ctx.command))
        return false

    //command is lowercased, but we need the original deck code
    const command = bot.getDeckCode(message.content)
    //check if in the cache
    const deckKey = cacheKeyPrefix + getChannelScope(message) +
        'deck:' + language + ':' + command
    //the probe is measured once, before anything is sent, so a forward that
    //fails and falls through cannot be charged to the cache
    const cacheStarted = Date.now()
    const cached = await redis.exists(deckKey)
        ? await redis.json.get(deckKey, '$')
        : null
    addTiming(ctx, 'cache', Date.now() - cacheStarted)

    if (cached) {
        const sendStarted = Date.now()
        if (await forwardCachedMessage(
            client, cached, message, {language, query: command})) {
            addTiming(ctx, 'send', Date.now() - sendStarted)
            setLog(ctx, {q: command, cache: 'HIT'})

            return true
        }
        //forward failed (e.g. no Read Message History) -> rebuild below
    }

    const deckLimit = await checkRoleDeckScreenshotLimit(ctx)
    if (!deckLimit.allowed) {
        await message.channel.send(deckLimit.message)
        setLog(ctx, {q: command, cache: 'MISS', result: 'limit reached'})

        return true
    }

    //not cached: queue the capture (the queue throttles concurrent renders)
    const sent = await createDeckImages(
        prefix, message, command, language, ctx.timings)
    if (sent) {
        await cacheSentMessage(redis, deckKey, sent, deckExp)
    }
    setLog(ctx, {q: command, cache: 'MISS',
        result: sent ? 'sent' : 'render failed'})

    return true
}

/**
 * Collect every alt-art file from synonyms whose key starts with "alt ".
 *
 * @param syns
 * @returns {Array}
 */
function collectAltFiles(syns)
{
    return syns.filter(syn => syn.key.startsWith('alt ')).map(syn =>
    {
        if (syn.value.startsWith('{')) {
            const filesObject = JSON.parse(syn.value)
            // some alt synonyms are text-only (content, no files) -> skip them
            return filesObject.files && filesObject.files[0]
        }
        return syn.value
    }).filter(Boolean)
}

/**
 * Show a paginated gallery of all alt-art cards.
 *
 * Pages are never cached: the gallery always runs to several pages, and a
 * cached page is replayed by forwarding it, which drops its "Next" button.
 * Each page is sent fresh; the button's id carries the next offset.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleAlt(ctx)
{
    const {message, language, limit} = ctx
    if (!ctx.command.startsWith('alt')) return false

    // Custom aliases (e.g. "alt heinz") are resolved upstream by
    // resolveSynonym, so anything reaching here is a gallery request. Only
    // "alt" + an offset (alt, alt10, alt20…) is valid pagination; anything
    // else ("alt art", "alt not_a_key") collapses to the first page.
    const command = /^alt\d*$/.test(ctx.command) ? ctx.command : 'alt'

    const files = collectAltFiles(await getAllSynonyms())
    if (!files.length) {
        await sendPrivately(message, translate(language, 'noresult'))
        setLog(ctx, {q: command, result: '0 found'})

        return true
    }

    let offset = parseInt(command.replace('alt', ''))
    if (isNaN(offset) || offset > files.length) offset = 0
    let last = offset + limit
    if (last > files.length) last = files.length
    const answer = {
        content: 'Alternate art cards found: ' + files.length +
            ', showing ' + (offset + 1) + '-' + last,
        files: files.slice(offset, offset + limit),
    }
    if (offset + limit < files.length && isBotCommandChannel(message))
        answer.components = getButtonRow(
            translate(language, 'next'), 'next_button_alt' + (offset + limit))

    const sendStarted = Date.now()
    await message.channel.send(answer)
    addTiming(ctx, 'send', Date.now() - sendStarted)
    setLog(ctx, {q: command, page: formatPage(offset, limit),
        result: files.length + ' found'})

    return true
}

module.exports = {
    handleDeck,
    handleAlt,
}
