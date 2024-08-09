const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')

/**
 *
 * @returns {ActionRowBuilder[]}
 */

function getButtonRow(label='Next', id)
{
    const button = new ButtonBuilder()
        .setCustomId('next_button_' + id)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)

    const row = new ActionRowBuilder().addComponents(button)

    return [row]

}

module.exports = {getButtonRow}