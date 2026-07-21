const {ActionRowBuilder, StringSelectMenuBuilder} = require('discord.js')
const {translate} = require("../../tools/translation/translator")
const {languages} = require("../../tools/language")
const {getButtonRow, ButtonStyle} = require("../../tools/button")
const {renderProfileText, reactionsLabel} = require("../../tools/profile")
const {getProfileStats} = require("../../database/db")

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
 * Build the profile overview (stats + language select + reactions toggle +
 * DM button) for a user. Shared by the slash command (shown directly) and the
 * legacy button flow (shown on click, then re-rendered after each toggle).
 *
 * @param user
 * @returns {Promise<{content: string, components: *}>}
 */
async function buildProfileView(user)
{
    const stats = await getProfileStats(user.id)
    const content = renderProfileText(user.language, stats)
    const components = [
        getLanguageSelectRow(user.language),
        ...getButtonRow(
            reactionsLabel(user.language, user),
            'profile_reactions',
            ButtonStyle.Secondary),
        //Discord-only: DMs are blocked until the user opens a channel with the
        //bot. Telegram allows them by default, so no equivalent button there.
        ...getButtonRow(
            translate(user.language, 'dmButton'),
            'profile_dm',
            ButtonStyle.Primary),
    ]

    return {content, components}
}

module.exports = {buildProfileView}
