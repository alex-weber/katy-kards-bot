const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')
const { translate } = require("../../tools/translation/translator")
const { getButtonRow } = require("../../tools/button")

//User statuses that require accepting the Terms of Service before the bot may
//be used. 'active' users (accepted or grandfathered) and admin-disabled users
//(e.g. 'inactive') are handled elsewhere.
const STATUS_PENDING = 'pending'
const STATUS_DECLINED = 'declined'
const STATUS_ACTIVE = 'active'

//Public base URL of the web app that serves /terms and /privacy. When unset,
//the explanation omits the links and shows the summary text only.
const webBaseUrl = (process.env.WEB_BASE_URL || '').replace(/\/+$/, '')
const termsUrl = webBaseUrl ? webBaseUrl + '/terms' : ''
const privacyUrl = webBaseUrl ? webBaseUrl + '/privacy' : ''

/**
 * Whether the user must accept the Terms of Service before using the bot.
 *
 * @param user
 * @returns {boolean}
 */
function requiresTermsAcceptance(user)
{
    return user.status === STATUS_PENDING || user.status === STATUS_DECLINED
}

/**
 * Build the "Terms & Privacy" links block, or an empty string when no web
 * base URL is configured.
 *
 * @returns {string}
 */
function termsLinks()
{
    if (!webBaseUrl) return ''

    return `\n\n📄 Terms of Service: ${termsUrl}\n🔒 Privacy Policy: ${privacyUrl}`
}

/**
 * Build the Accept / Decline button row. The Accept button is disabled (greyed
 * out) when the user has already accepted the terms.
 *
 * @param language
 * @param user
 * @returns {ActionRowBuilder[]}
 */
function getTermsDecisionRow(language, user)
{
    const accepted = user.status === STATUS_ACTIVE
    const accept = new ButtonBuilder()
        .setCustomId('terms_accept')
        .setLabel(translate(language, 'termsAccept'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(accepted)
    const decline = new ButtonBuilder()
        .setCustomId('terms_decline')
        .setLabel(translate(language, 'termsDecline'))
        .setStyle(ButtonStyle.Danger)

    return [new ActionRowBuilder().addComponents(accept, decline)]
}

/**
 * Build the ephemeral terms view shown after the "Read Terms" button is
 * clicked: the translated explanation with links, plus the Accept / Decline
 * buttons. Kept ephemeral so it never floods a public channel.
 *
 * @param language
 * @param user
 * @returns {{content: string, components: ActionRowBuilder[]}}
 */
function buildTermsView(language, user)
{
    return {
        content: translate(language, 'termsExplain', {links: termsLinks()}),
        components: getTermsDecisionRow(language, user),
    }
}

/**
 * Send the public prompt with a single "Read Terms" button. The button opens
 * the ephemeral explanation (with Accept / Decline) on click, so the details
 * are not spammed into the channel.
 *
 * @param ctx
 * @returns {Promise<void>}
 */
async function sendTermsPrompt(ctx)
{
    const {message, language} = ctx
    await message.channel.send({
        content: translate(language, 'termsPrompt'),
        components: getButtonRow(
            translate(language, 'termsButton'), 'terms_show'),
    })
}

/**
 * `!terms` — show the "Read Terms" prompt.
 *
 * @param ctx
 * @returns {Promise<boolean>}
 */
async function handleTerms(ctx)
{
    if (ctx.command !== 'terms') return false

    await sendTermsPrompt(ctx)

    return true
}

/**
 * Gate for users who have not accepted the terms. The terms command is allowed
 * through (it renders the same prompt); every other command instead shows the
 * prompt so the user can read and accept.
 *
 * @param ctx
 * @returns {Promise<boolean>} true when the command was gated (stop)
 */
async function handleTermsGate(ctx)
{
    if (!requiresTermsAcceptance(ctx.user)) return false
    if (ctx.command === 'terms') return false

    await sendTermsPrompt(ctx)

    return true
}

module.exports = {
    STATUS_PENDING,
    STATUS_DECLINED,
    STATUS_ACTIVE,
    requiresTermsAcceptance,
    sendTermsPrompt,
    getTermsDecisionRow,
    buildTermsView,
    handleTerms,
    handleTermsGate,
}
