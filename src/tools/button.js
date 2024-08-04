const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')

/**
 *
 * @returns {ActionRowBuilder[]}
 */

function getButtonRow(label='Next')
{
    const button = new ButtonBuilder()
        .setCustomId('next_button')
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)

    const row = new ActionRowBuilder().addComponents(button)

    return [row]

}

module.exports = {getButtonRow}