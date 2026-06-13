const {
    cacheKeyPrefix,
    getGuildPart,
    forwardCachedMessage,
    cacheSentMessage,
} = require("../messageCache")
const {translate} = require("../../tools/translation/translator")
const {APILanguages} = require("../../tools/language")
const {
    isBotCommandChannel,
    getCards,
    getFiles,
} = require("../../tools/search")
const {getButtonRow} = require("../../tools/button")

//cache lifetimes (seconds)
const paginationExp = process.env.REDIS_EXP_PAGINATION || 60 * 10 // 10 min
const searchExp = process.env.REDIS_EXP_SEARCH || 60 * 60 * 24 * 90 //90 days
//hide the cards (just show the count) above this many results
const noShowThreshold = 20

/**
 * Serve a previously cached search result, if present.
 *
 * @param ctx
 * @param cacheKey
 * @returns {Promise<boolean>} true when served from cache
 */
async function serveSearchCache(ctx, cacheKey)
{
    const {message, client, redis, language, command, limit} = ctx
    if (message.buttonId) return false
    if (!(await redis.exists(cacheKey))) return false

    console.time('cache')
    console.log('serving from cache: ', language, command, limit)
    const answer = await redis.json.get(cacheKey, '$')
    console.timeEnd('cache')
    message.react('✅')
    await forwardCachedMessage(
        client, answer, message.channel, message.channelId)

    return true
}

/**
 * Build the KARDS API query variables, advancing the offset for buttons.
 *
 * @param ctx
 * @returns {Promise<{variables: object, offset: number}>}
 */
async function buildSearchVariables(ctx)
{
    const {message, redis, language, command, limit, cmdCacheKey} = ctx
    let offset = 0
    const variables = {
        language: APILanguages[language],
        q: command,
        showSpawnables: true,
        showReserved: true,
        first: limit,
        offset: offset,
    }
    //check if we need the next page instead
    if (message.buttonId) {
        //set the language of the command, not the user
        variables.language = APILanguages[message.language]
        offset = limit
        let result = await redis.json.get(cmdCacheKey, '$')
        result = parseInt(result.offset)
        if (!isNaN(result) && result > 0) offset = result

        variables.offset = offset
        //add limit to offset for the next fetch
        await redis.json.set(cmdCacheKey, '$.offset', offset + limit)
        await redis.expire(cmdCacheKey, paginationExp) //refresh expiration
    }

    return {variables, offset}
}

/**
 * Store the pagination state so the "Next" button can resume the search.
 *
 * @param ctx
 * @param offset
 * @returns {Promise<void>}
 */
async function initPagination(ctx, offset)
{
    const {message, redis, language, cmdCacheKey} = ctx
    if (message.buttonId) return

    const cachedCommand = {
        command: message.content,
        offset: offset,
        language: language,
    }
    await redis.json.set(cmdCacheKey, '$', cachedCommand)
    await redis.expire(cmdCacheKey, paginationExp) // 10 minutes
}

/**
 * Build the reply content + "Next" button for a multi-page result.
 *
 * @param ctx
 * @param answer mutated with content/components
 * @param counter total number of matches
 * @param offset current page offset
 * @returns {Promise<void>}
 */
async function applyPagination(ctx, answer, counter, offset)
{
    const {message, redis, language, command, limit, cmdCacheKey} = ctx
    await initPagination(ctx, offset)

    let toCounter = offset + limit
    if (toCounter > counter) toCounter = counter
    answer.content += translate(language, 'limit') +
        (offset + 1).toString() + ' - ' + toCounter.toString()

    //add the "Next" button (only in bot-command channels)
    if (counter - offset > limit && isBotCommandChannel(message)) {
        const id = command.replace(' ', '_')
        answer.components = getButtonRow(
            translate(language, 'next'), 'next_button_' + id)
    } else {
        await redis.del(cmdCacheKey)
    }
}

/**
 * Send the found cards, attaching images and caching small result sets.
 *
 * @param ctx
 * @param cacheKey
 * @param cards
 * @param offset
 * @returns {Promise<void>}
 */
async function sendCardResults(ctx, cacheKey, cards, offset)
{
    const {message, redis, language, limit, paginationLimit} = ctx
    const counter = cards.counter
    //if any cards are found - attach them
    let content = translate(language, 'search') + ': ' + counter
    //do not show any cards if there are more than 20 cards
    if (counter > noShowThreshold && !isBotCommandChannel(message)) {
        const sent = await message.channel.send(
            content + translate(language, 'noshow'))
        sent.react('👆')

        return
    }

    const answer = {content}
    //warn that there are more cards found
    if (counter > limit) await applyPagination(ctx, answer, counter, offset)

    //attach found images
    answer.files = getFiles(cards, language, limit)
    //reply to user
    try {
        message.react('✅')
        const sent = await message.channel.send(answer)
        console.log(`Cards found: ${counter}  Limit: ${limit}`)
        //cache only within the limit, so pagination still works
        if (counter <= paginationLimit)
            await cacheSentMessage(redis, cacheKey, sent, searchExp)
    } catch (e) {
        console.error(e.message)
        message.channel.send(translate(language, 'error'))
    }
}

/**
 * Search KARDS.com (with a local DB fallback) and reply with the cards.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleSearch(ctx)
{
    const {message, redis, language, command, limit, user} = ctx
    //check if in the cache
    const cacheKey = cacheKeyPrefix + getGuildPart(message) +
        language + ':' + command + limit
    if (await serveSearchCache(ctx, cacheKey)) return true

    //first search on KARDS.com, on no result search in the local DB
    const {variables, offset} = await buildSearchVariables(ctx)
    const cards = await getCards(variables)
    if (!cards) {
        await message.channel.send(translate(language, 'error'))

        return true
    }

    if (!cards.counter) {
        let reply = translate(language, 'noresult')
        if (user.mode) reply = user.mode + '\n\n' + reply
        message.react('❓')
        await message.channel.send(reply)

        return true
    }

    await sendCardResults(ctx, cacheKey, cards, offset)

    return true
}

module.exports = {
    handleSearch,
}
