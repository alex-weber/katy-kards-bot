/**
 * Send a "nothing found" style reply. Slash commands can show it privately to
 * the invoking user (via message.replyPrivately, set up by
 * buildInteractionMessage for the slash pipeline) instead of spamming the
 * public channel with a result nobody else cares about. Legacy `!` commands
 * have no ephemeral channel to fall back to, so they still post publicly.
 *
 * @param message
 * @param payload string or discord.js message-options object
 * @returns {Promise<void>}
 */
async function sendPrivately(message, payload)
{
    if (message.replyPrivately) return await message.replyPrivately(payload)
    await message.channel.send(payload)
}

module.exports = {sendPrivately}
