const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js')

const dictionary = require('../dictionary')

function getDefaultCMObject()
{
    return {
        faction: '',
        type: '',
        rarity: '',
        title: '',
        text: '',
        kredits: null,
        operationCost: null,
        attack: null,
        defense: null,
        link: '',
    }
}

/**
 *
 * @param message
 * @param userId
 * @param redis
 * @returns {Promise<void>}
 */
async function handeInteraction(message, userId, redis)
{
    const command = message.cardmakerId
    const cmKey = 'card_maker:' + userId
    let cmObject = getDefaultCMObject()

    const cachedCMObject = await redis.json.get(cmKey, '$')

    if (cachedCMObject)
    {
       cmObject = cachedCMObject
    }

    if (command.includes('_button_'))
    {
        return message.channel.send(JSON.stringify(cmObject))
    }
    cmObject = setCMProperties(command, cmObject)
    await redis.json.set(cmKey, '$', cmObject)

}

function setCMProperties(id, cmObject)
{
    const action = id.replace('cardmaker_', '').split('_')
    const command = action[0]
    const value = action[1]
    switch (command) {
        case 'button':
            return cmObject
        case 'faction':
            cmObject.faction = value
            break
        case 'type':
            cmObject.type = value
            break
        case 'rarity':
            cmObject.rarity = value
            break
        default:
            return cmObject
    }

    return cmObject
}


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

function getFirstStepRows()
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
        .setCustomId('cardmaker_button_step1')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
    const buttonRow = new ActionRowBuilder().addComponents(button)
    actionRows.push(buttonRow)

    return actionRows
}

module.exports = {
    getFirstStepRows,
    handeInteraction,
}
