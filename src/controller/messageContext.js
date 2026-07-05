const bot = require("./bot")
const {cacheKeyPrefix} = require("./messageCache")
const {getUser, updateUser} = require("../database/db")
const {
    getLanguageByInput,
    defaultLanguage,
} = require("../tools/language")
const {isEnglishOnlyChannel} = require("../tools/search")
const {requiresTermsAcceptance} = require("./commands/termsCommands")

//refresh window for the cached user record
const userExp = process.env.REDIS_EXP_USER || 60 * 60 * 24 * 7 // 7 days

/**
 * Resolve the command cache key and, for button presses, rewrite the
 * message content from the cached command.
 *
 * @param message
 * @param redis
 * @param prefix
 * @returns {Promise<{cmdCacheKey: string, stop?: boolean}>}
 */
async function resolveButtonCommand(message, redis, prefix)
{
    let cmdCacheKey = 'command:'
    if (!message.buttonId) {
        cmdCacheKey += 'next_button_' +
            bot.parseCommand(prefix, message.content).replace(' ', '_')
    }
    if (message.buttonId) {
        const isAltArtButton =
            message.buttonId.startsWith('next_button_alt')
        if (isAltArtButton) {
            message.content =
                message.buttonId.replace('next_button_', prefix)
            message.language = defaultLanguage
        } else {
            cmdCacheKey += message.buttonId
            const result = await redis.json.get(cmdCacheKey, '$')
            if (!result || !result.command) return {cmdCacheKey, stop: true}
            message.content = result.command
            message.language = result.language
        }

        message.author.bot = false
    }

    return {cmdCacheKey}
}

/**
 * Load the user from cache, or from the DB and warm the cache.
 *
 * @param message
 * @param redis
 * @returns {Promise<*>}
 */
async function loadUser(message, redis)
{
    let user
    const userId = message.author.id.toString()
    console.time('getUser_' + userId)
    const userKey = cacheKeyPrefix + 'user:' + userId
    const cachedUser = await redis.json.get(userKey, '$')
    if (!cachedUser || !cachedUser.hasOwnProperty('id')) {
        console.log('no user in cache, caching')
        user = await getUser(userId)
        await redis.json.set(userKey, '$', user)
        await redis.expire(userKey, userExp)
    } else {
        console.log('getting user from cache')
        user = cachedUser
    }
    console.timeEnd('getUser_' + userId)

    return user
}

/**
 * React and reply for blocked users. Users who still need to accept the Terms
 * of Service ('pending'/'declined') are not hard-blocked here — the terms gate
 * handles them next so they can read the policy and accept.
 *
 * @param user
 * @param message
 * @returns {boolean} true when the user is blocked (stop processing)
 */
function checkUserStatus(user, message)
{
    if (user.status === 'active' || requiresTermsAcceptance(user)) return false

    message.react('🚫')
    console.log('blocked user\n', user)
    if (user.mode) message.channel.send(user.mode)

    return true
}

/**
 * Persist the Discord username on first contact.
 *
 * @param user
 * @param message
 * @returns {Promise<void>}
 */
async function ensureUserName(user, message)
{
    if (!user.name) {
        user.name = message.author.username
        await updateUser(user)
    }
}

/**
 * Resolve the language to use for this command.
 *
 * @param ctx
 * @returns {Promise<string>}
 */
async function resolveLanguage(ctx)
{
    const {message, redis, user, command} = ctx
    const userId = message.author.id.toString()
    const userKey = cacheKeyPrefix + 'user:' + userId

    let language = user.language
    //use the message language if it's the "next" button
    if (message.buttonId) language = message.language
    //set user language to russian if they type in cyrillic
    if (getLanguageByInput(command) === 'ru' && language !== 'ru') {
        user.language = 'ru'
        console.time('updateUser' + userId)
        await updateUser(user)
        //change user language to ru
        await redis.json.set(userKey, '$.language', 'ru')
        await redis.expire(userKey, userExp) //refresh expiration
        console.timeEnd('updateUser' + userId)
        language = 'ru'
    }
    //switch to English for English only channels
    if (isEnglishOnlyChannel(message) && language !== 'en') {
        language = 'en'
    }

    return language
}

module.exports = {
    resolveButtonCommand,
    loadUser,
    checkUserStatus,
    ensureUserName,
    resolveLanguage,
}
