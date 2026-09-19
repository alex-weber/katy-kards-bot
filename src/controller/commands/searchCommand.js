const {
    cacheKeyPrefix,
    getChannelScope,
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
const {react} = require("../../tools/reactions")
const {sendPrivately} = require("../../tools/privateReply")
const {setLog, addTiming, formatPage} = require("../../tools/commandLog")

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
    const {message, client, redis, language, command, user} = ctx
    if (message.buttonId) return false
    //the whole probe is timed, the existence check included, and recorded even
    //when it misses - both round trips are paid for either way, and a miss that
    //reports nothing makes the fallback look cheaper than it is
    const cacheStarted = Date.now()
    if (!(await redis.exists(cacheKey))) {
        addTiming(ctx, 'cache', Date.now() - cacheStarted)

        return false
    }

    const answer = await redis.json.get(cacheKey, '$')
    addTiming(ctx, 'cache', Date.now() - cacheStarted)

    //forward failed (e.g. no Read Message History) -> let handleSearch regenerate
    const sendStarted = Date.now()
    if (!await forwardCachedMessage(client, answer, message,
        {language, query: command, key: 'cacheForwardNotice'}))
        return false
    addTiming(ctx, 'send', Date.now() - sendStarted)
    react(message, '✅', user)
    //cache hits are never paginated (buttonId returns above), so always page 1
    setLog(ctx, {cache: 'HIT', page: 'p1'})

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
    const {message, redis, language, command, limit, paginationLimit, user} = ctx
    const counter = cards.counter
    //if any cards are found - attach them
    let content = ''
    //show the search request above the counter on paginated results
    if (message.buttonId) content += '> 🔎 ' + command + '\n'
    content += translate(language, 'search') + ': ' + counter
    //do not show any cards if there are more than 20 cards
    if (counter > noShowThreshold && !isBotCommandChannel(message)) {
        const sent = await message.channel.send(
            content + translate(language, 'noshow'))
        react(sent, '👆', user)
        setLog(ctx, {cache: 'MISS', page: formatPage(offset, ctx.limit),
            result: counter + ' found (hidden)'})

        return
    }

    const answer = {content}
    //warn that there are more cards found
    if (counter > limit) await applyPagination(ctx, answer, counter, offset)

    //attach found images
    answer.files = getFiles(cards, language, limit)
    //reply to user
    try {
        react(message, '✅', user)
        const sendStarted = Date.now()
        const sent = await message.channel.send(answer)
        addTiming(ctx, 'send', Date.now() - sendStarted)
        setLog(ctx, {cache: 'MISS', page: formatPage(offset, ctx.limit),
            result: counter + ' found'})
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
    const {message, language, command, limit, user} = ctx
    //check if in the cache
    const cacheKey = cacheKeyPrefix + getChannelScope(message) +
        language + ':' + command + limit
    if (await serveSearchCache(ctx, cacheKey)) return true

    //first search on KARDS.com, on no result search in the local DB.
    //ctx.timings is filled in with the api/db latencies for the summary line.
    const {variables, offset} = await buildSearchVariables(ctx)
    const cards = await getCards(variables, 3000, ctx.timings)
    if (!cards) {
        await message.channel.send(translate(language, 'error'))

        return true
    }

    if (!cards.counter) {
        let reply = translate(language, 'noresult')
        if (user.mode) reply = user.mode + '\n\n' + reply
        react(message, '❓', user)
        await sendPrivately(message, reply)
        setLog(ctx, {cache: 'MISS', page: formatPage(offset, ctx.limit),
            result: '0 found'})

        return true
    }

    await sendCardResults(ctx, cacheKey, cards, offset)

    return true
}

module.exports = {
    handleSearch,
}
