/**
 * React to a message with an emoji, unless the user has opted out of the
 * bot's reactions (User.reactions === false). A missing flag means reactions
 * are on, so behaviour is unchanged for users who never touched the setting.
 *
 * Works for both Discord messages (message.react) and the Telegram context
 * (ctx.react). The returned promise is ignored by callers (fire-and-forget).
 *
 * @param target Discord message / Telegram context exposing react()
 * @param emoji
 * @param user the acting user (optional)
 * @returns {Promise<*>|void}
 */
function react(target, emoji, user)
{
    if (user && user.reactions === false) return

    return target.react(emoji)
}

module.exports = {react}
