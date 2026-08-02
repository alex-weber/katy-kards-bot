const {translate} = require("./translation/translator")

/**
 * Format a leaderboard position as "#N", or "n/a" when the user isn't ranked.
 *
 * @param position
 * @returns {string}
 */
function formatPosition(position)
{
    return position ? '#' + position : 'n/a'
}

/**
 * Build the profile overview text from the stats. Grouped into an all-time and
 * a this-month section to mirror the web profile. Uses only emoji + plain text
 * (no markdown), since Telegram sends this reply without a parse mode.
 *
 * No title of its own: the Discord embed shows the user's avatar + name in its
 * author line instead, and Telegram passes the name as `heading`. The language
 * line drops the code, since the select below already shows the current one.
 *
 * @param language
 * @param stats
 * @param heading optional first line (e.g. the user's name on Telegram)
 * @returns {string}
 */
function renderProfileText(language, stats, heading)
{
    const bullet = (labelKey, value) => '• ' + translate(language, labelKey) + value
    // Drop the trailing ": " / "：" so the label reads as a heading for the select.
    const languageLabel = translate(language, 'profileLanguage').replace(/[:：]\s*$/, '')

    return (heading ? heading + '\n\n' : '') +
        translate(language, 'profileSectionAllTime') + '\n' +
        bullet('profileRank', formatPosition(stats.allTimePosition)) + '\n' +
        bullet('profileCommands', stats.total) + '\n\n' +
        translate(language, 'profileSectionMonth') + '\n' +
        bullet('profileRank', formatPosition(stats.currentMonthPosition)) + '\n' +
        bullet('profileCommands', stats.currentMonth) + '\n' +
        bullet('profileDay', stats.lastDay) + '\n\n' +
        '🌐 ' + languageLabel
}

/**
 * Label for the reactions toggle, reflecting the user's current setting.
 *
 * @param language
 * @param user
 * @returns {string}
 */
function reactionsLabel(language, user)
{
    return user.reactions === false
        ? translate(language, 'reactionsOff')
        : translate(language, 'reactionsOn')
}

module.exports = {renderProfileText, reactionsLabel, formatPosition}
