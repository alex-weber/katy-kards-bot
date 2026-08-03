const {ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, escapeMarkdown} = require('discord.js')
const {translate} = require("../../tools/translation/translator")
const {languages} = require("../../tools/language")
const {getButtonRow, ButtonStyle} = require("../../tools/button")
const {reactionsLabel, formatPosition} = require("../../tools/profile")
const {getProfileStats} = require("../../database/db")

// Stat labels reuse the slash-text translations, which carry a trailing
// ": " / "："; they read better inline without it.
const stripColon = label => label.replace(/[:：]\s*$/, '')
// Bold the number so it stands out from its label on the same line.
const statValue = value => '**' + value + '**'
// Embed accent color (the blue used by the web profile's all-time card).
const COLOR_ACCENT = 0x3F6EFD

/**
 * Build the search-language select, with the user's current choice preselected.
 *
 * @param language the user's current search language
 * @returns {ActionRowBuilder}
 */
function getLanguageSelectRow(language)
{
    const menu = new StringSelectMenuBuilder()
        .setCustomId('profile_language')
        .setPlaceholder(translate(language, 'profileLanguage'))
        .addOptions(languages.map(lang => ({
            label: lang.toUpperCase(),
            value: lang,
            default: lang === language,
        })))

    return new ActionRowBuilder().addComponents(menu)
}

/**
 * The invoking user's server display name and avatar, matching the "requested
 * by" attribution: the guild nickname when present, then the account's global
 * display name, then the username; the member (server) avatar when set, else
 * the global one. Reads through optional chaining so a DM interaction (no
 * member) or a bare test double degrades to the plain user / no avatar.
 *
 * @param interaction discord.js interaction
 * @returns {{displayName: string, avatarUrl: (string|null)}}
 */
function profileIdentity(interaction)
{
    const member = interaction?.member
    const user = interaction?.user
    const avatarOpts = {extension: 'webp', size: 256}

    return {
        displayName: member?.displayName || user?.displayName || user?.username || 'Profile',
        avatarUrl:
            member?.displayAvatarURL?.(avatarOpts) ||
            user?.displayAvatarURL?.(avatarOpts) ||
            null,
    }
}

/**
 * Build the profile overview for a user, shared by the slash command (shown
 * directly) and the legacy button flow (re-rendered after each toggle).
 *
 * A single embed keeps both sections the same width (each is one line of text
 * rather than variable-width field columns). The avatar + server display name
 * (see profileIdentity) sit on the author line, replacing the old "Your stats"
 * title; the language select below is self-explanatory, so it carries no label.
 *
 * @param user
 * @param identity {displayName, avatarUrl} from profileIdentity
 * @returns {Promise<{embeds: *, components: *}>}
 */
async function buildProfileView(user, identity = {})
{
    const stats = await getProfileStats(user.id)
    const lang = user.language
    const rank = stripColon(translate(lang, 'profileRank'))
    const commands = stripColon(translate(lang, 'profileCommands'))
    const day = stripColon(translate(lang, 'profileDay'))
    const stat = (label, value) => `${label} ${statValue(value)}`

    const allTimeLine = [
        stat(rank, formatPosition(stats.allTimePosition)),
        stat(commands, stats.total),
    ].join('  ·  ')
    const thisMonthLine = [
        stat(rank, formatPosition(stats.currentMonthPosition)),
        stat(commands, stats.currentMonth),
        stat(day, stats.lastDay),
    ].join('  ·  ')

    // Markdown headers enlarge text in an embed description (unlike in fields),
    // giving a real size hierarchy — Discord renders H2 and H3 nearly the same,
    // so only two levels are used: H1 name > H2 section > normal stat lines.
    // The name lives in the description (escaped) so it can be an H1; the small
    // author line would leave it tiny. Numbers stay bold to stand out.
    const name = escapeMarkdown(identity.displayName || 'Profile')
    const embed = new EmbedBuilder()
        .setColor(COLOR_ACCENT)
        .setDescription(
            `# ${name}\n` +
            `## ${translate(lang, 'profileSectionAllTime')}\n${allTimeLine}\n\n` +
            `## ${translate(lang, 'profileSectionMonth')}\n${thisMonthLine}`)
    // Show the avatar large in the top-right corner rather than as a small icon.
    if (identity.avatarUrl) embed.setThumbnail(identity.avatarUrl)

    const components = [
        getLanguageSelectRow(lang),
        ...getButtonRow(
            reactionsLabel(lang, user),
            'profile_reactions',
            ButtonStyle.Secondary),
        //Discord-only: DMs are blocked until the user opens a channel with the
        //bot. Telegram allows them by default, so no equivalent button there.
        ...getButtonRow(
            translate(lang, 'dmButton'),
            'profile_dm',
            ButtonStyle.Primary),
        //Re-post this (ephemeral) profile publicly in the channel — handled in
        //discordClient, which gates it on the bot's send permission there.
        ...getButtonRow(
            translate(lang, 'profileShare'),
            'profile_share',
            ButtonStyle.Secondary),
    ]

    return {embeds: [embed], components}
}

module.exports = {buildProfileView, profileIdentity}
