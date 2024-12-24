const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js')

const dictionary = require('../dictionary')

// Generate random options for the select menus
function generateOptions(type, options) {
    const selectOptions = []
    for (option of options) {
        selectOptions.push({
            label: option.toUpperCase(),
            value: `${type}_${option}`
        })
    }
    return selectOptions
}

function getCardmakerActionRows()
{
    const selectMenus = []

    const factionMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_faction`)
        .setPlaceholder(`Select Faction`)
        .addOptions(
            generateOptions('faction', dictionary.faction)
        )
    selectMenus.push(factionMenu)

    const typeMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_type`)
        .setPlaceholder(`Select Type`)
        .addOptions(generateOptions('type', dictionary.type))
    selectMenus.push(typeMenu)

    const rarityMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_rarity`)
        .setPlaceholder(`Select Rarity`)
        .addOptions(generateOptions( 'rarity', dictionary.rarity))
    selectMenus.push(rarityMenu)


    // Build action rows
    const actionRows = selectMenus.map(
        menu => new ActionRowBuilder().addComponents(menu)
    )

    const button = new ButtonBuilder()
        .setCustomId('cardmaker_create')
        .setLabel('Create')
        .setStyle(ButtonStyle.Primary)
    const buttonRow = new ActionRowBuilder().addComponents(button)
    actionRows.push(buttonRow)

    return actionRows
}

module.exports = {
    getCardmakerActionRows,
}
