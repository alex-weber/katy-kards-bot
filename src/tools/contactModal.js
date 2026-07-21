const {ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js')
const {translate} = require('./translation/translator')

/**
 * Build the "message the bot admins" modal. Shared by the slash command
 * (shown directly) and the legacy button flow (shown on click).
 *
 * @param language
 * @returns {ModalBuilder}
 */
function buildContactModal(language)
{
    const modal = new ModalBuilder()
        .setCustomId('contact_admins_modal')
        .setTitle(translate(language, 'contactModalTitle') || 'Contact Administrators')

    const input = new TextInputBuilder()
        .setCustomId('contactMessage')
        .setLabel(translate(language, 'contactModalInputLabel') || 'Your Message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder(translate(language, 'contactModalInputPlaceholder') || 'Please describe your issue or request...')

    return modal.addComponents(new ActionRowBuilder().addComponents(input))
}

module.exports = {buildContactModal}
