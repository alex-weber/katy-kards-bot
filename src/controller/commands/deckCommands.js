const bot = require("../bot")
const {
    cacheKeyPrefix,
    getGuildPart,
    forwardCachedMessage,
    cacheSentMessage,
} = require("../messageCache")
const {getAllSynonyms} = require("../../database/db")
const {translate} = require("../../tools/translation/translator")
const {createDeckImages} = require("../../tools/deck")
const {getButtonRow} = require("../../tools/button")
const {isBotCommandChannel} = require("../../tools/search")
const {react} = require("../../tools/reactions")
const {checkRoleDeckScreenshotLimit} = require("../../tools/roles")

//cache lifetimes (seconds)
const deckExp = process.env.REDIS_EXP_DECK || 60 * 60 * 24 * 30 // 30 days
const searchExp = process.env.REDIS_EXP_SEARCH || 60 * 60 * 24 * 90 //90 days
//delete the screenshot lock key after this many seconds anyway
const screenshotTimeout = parseInt(process.env.SCREENSHOT_TIMEOUT) || 30

/**
 * Render a deck link / deck code as card images.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleDeck(ctx)
{
    const {message, client, redis, prefix, language, user} = ctx
    if (!bot.isDeckLink(ctx.command) && !bot.isDeckCode(ctx.command))
        return false

    //command is lowercased, but we need the original deck code
    const command = bot.getDeckCode(message.content)
    //check if in the cache
    const deckKey = cacheKeyPrefix + getGuildPart(message) +
        'deck:' + language + ':' + command
    if (await redis.exists(deckKey)) {
        const response = await redis.json.get(deckKey, '$')
        console.log('serving deck from cache', deckKey)
        await forwardCachedMessage(
            client, response, message.channel, message.channelId)

        return true
    }

    const deckLimit = await checkRoleDeckScreenshotLimit(ctx)
    if (!deckLimit.allowed) {
        await message.channel.send(deckLimit.message)
        return true
    }

    //tell the user to wait if a screenshot capture is already running
    const screenshotKey = cacheKeyPrefix + 'screenshot'
    if (await redis.exists(screenshotKey)) {
        const sent = await message.channel.send(
            translate(language, 'screenshotRunning'))
        react(sent, '☕', user)
        react(sent, '🍩', user)

        return true
    }

    await redis.set(screenshotKey, 'running')
    redis.expire(screenshotKey, screenshotTimeout)
    const sent = await createDeckImages(prefix, message, command, language)
    await cacheSentMessage(redis, deckKey, sent, deckExp)

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
            return filesObject.files[0]
        }
        return syn.value
    })
}

/**
 * Show a paginated gallery of all alt-art cards.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleAlt(ctx)
{
    const {message, client, redis, language, limit, user} = ctx
    if (!ctx.command.startsWith('alt')) return false

    const cacheKey = cacheKeyPrefix + getGuildPart(message) +
        'alt:' + language + ':' + ctx.command
    if (await redis.exists(cacheKey)) {
        const response = await redis.json.get(cacheKey, '$')
        console.log('serving alt from cache', cacheKey)
        await forwardCachedMessage(
            client, response, message.channel, message.channelId)

        return true
    }

    const syns = await getAllSynonyms()
    const files = collectAltFiles(syns)
    if (!files.length) {
        await message.channel.send(translate(language, 'noresult'))

        return true
    }

    let offset = parseInt(ctx.command.replace('alt', ''))
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

    react(message, '✅', user)
    const sent = await message.channel.send(answer)
    await cacheSentMessage(redis, cacheKey, sent, searchExp)

    return true
}

module.exports = {
    handleDeck,
    handleAlt,
}
