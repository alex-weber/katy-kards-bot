const {translate} = require("./translation/translator")

/**
 * Build the profile overview text from the stats.
 *
 * @param language
 * @param stats
 * @returns {string}
 */
function renderProfileText(language, stats)
{
    return translate(language, 'profileTitle') + '\n\n' +
        translate(language, 'profileTotal') + stats.total + '\n' +
        translate(language, 'profileMonth') + stats.lastMonth + '\n' +
        translate(language, 'profileDay') + stats.lastDay + '\n\n' +
        translate(language, 'profileLanguage') + language + '\n'
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

module.exports = {renderProfileText, reactionsLabel}
