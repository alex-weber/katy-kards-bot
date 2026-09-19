const {translate} = require('./translation/translator')

//how long a run of fruitless searches is remembered
const streakExp = process.env.REDIS_EXP_FAIL_STREAK || 60 * 60 // 1 hour
//show the help text on this many empty searches in a row
const helpThreshold = parseInt(process.env.HELP_AFTER_FAILURES) || 3

//keyed on the internal User.id rather than a platform id: it is the one
//identifier both handlers already hold, so a user fumbling the query syntax
//stays one person whichever side they type on
const keyPrefix = process.env.NODE_ENV === 'production'
    ? 'failures:'
    : 'dev:failures:'

/**
 * The streak key for a user.
 *
 * @param user
 * @returns {string}
 */
function streakKey(user)
{
    return keyPrefix + user.id
}

/**
 * Count one search that came back empty and report whether the user has now
 * missed often enough to be shown the help text.
 *
 * The counter is cleared as soon as it reports true, so the help appears once
 * per streak rather than on every miss from the third one on.
 *
 * @param redis
 * @param user
 * @returns {Promise<boolean>} true when the help should be attached
 */
async function recordEmptySearch(redis, user)
{
    const key = streakKey(user)
    const count = await redis.incr(key)
    //INCR leaves the key without a TTL, so the window is re-armed on every
    //miss: the run has to be consecutive in time as well as in outcome
    await redis.expire(key, streakExp)
    if (count < helpThreshold) return false
    await redis.del(key)

    return true
}

/**
 * Forget the user's run of empty searches. Called on every answered search -
 * one DEL on a key that usually does not exist, which is what keeps "three in
 * a row" from meaning "three at any point in the last hour".
 *
 * @param redis
 * @param user
 * @returns {Promise<void>}
 */
async function clearEmptySearches(redis, user)
{
    await redis.del(streakKey(user))
}

/**
 * The help text as it is shown after a run of empty searches: the same text
 * `/help` prints, behind a line saying why it turned up uninvited.
 *
 * @param language
 * @param fenced wrap the command list in a Discord code block
 * @returns {string}
 */
function searchHelp(language, fenced = false)
{
    const help = translate(language, 'help')

    return translate(language, 'failureHelp') + '\n' +
        (fenced ? '```' + help + '```' : help)
}

module.exports = {recordEmptySearch, clearEmptySearches, searchHelp}
