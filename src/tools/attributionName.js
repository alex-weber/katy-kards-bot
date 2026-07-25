const {escapeMarkdown} = require('discord.js')

/**
 * The name to print when the bot says who asked for something.
 *
 * People in a channel know each other by the nickname they show there, not by
 * the unique @username, so attribution is useless to a moderator if it names
 * someone nobody recognises. GuildMember#displayName is that nickname and
 * already falls back to the account's global display name and then the
 * username; User#displayName covers DMs, where there is no member at all. A
 * member that arrives straight off the API (uncached guild) is a plain object
 * with `nick` rather than a GuildMember, so that shape is read too.
 *
 * The result is escaped, because unlike a username — letters, digits, dot,
 * underscore, hyphen — a nickname can hold any markdown at all, and the
 * attribution line puts it inside italics. Escaping here means the callers
 * cannot forget it; it does not make the name safe to *mention*, which is what
 * the allowedMentions on those sends is for.
 *
 * @param user discord.js User
 * @param member GuildMember, raw API member, or null in a DM
 * @returns {string} ready to interpolate into message text
 */
function attributionName(user, member) {
    const name = member?.displayName || member?.nick || user?.displayName || user?.username

    return escapeMarkdown(name || 'unknown')
}

module.exports = {attributionName}
