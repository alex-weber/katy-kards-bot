const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')

/**
 *
 * @param label
 * @param id
 * @param style optional ButtonStyle (defaults to Primary)
 * @returns {ActionRowBuilder[]}
 */

function getButtonRow(label='Next', id, style=ButtonStyle.Primary)
{
    const button = new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)

    const row = new ActionRowBuilder().addComponents(button)

    return [row]

}

module.exports = {getButtonRow, ButtonStyle}