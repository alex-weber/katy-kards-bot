const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js')

const dictionary = require('../dictionary')
const {translate} = require("../translation/translator")

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
        stage: 'step1',
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
    cmObject = setCMProperties(command, cmObject)
    await redis.json.set(cmKey, '$', cmObject)

    if (cmObject.stage === 'step2')
    {
        if (!cmObject.faction || !cmObject.rarity || !cmObject.kredits || !cmObject.type )
        {
            await redis.json.set(cmKey, '$.stage', 'step1')

            return message.reply({
                content: 'all fields are mandatory in step 1',
            })
        }

        await message.channel.send(JSON.stringify(cmObject))

        if (cmObject.type === 'order' || cmObject.type === 'countermeasure')
        {
            await redis.json.set(cmKey, '$.stage', 'step4')

            return message.reply({
                content: 'proceed to step 4',
            })

        }

        await redis.json.set(cmKey, '$.stage', 'step3')

        message.channel.send({
            content: 'Card Maker: Step 2',
            components: getSecondStepRows(),
        })

        message.delete()
    }

    if (cmObject.stage === 'step3')
    {

        if (!cmObject.operationCost || !cmObject.attack || !cmObject.defense)
        {
            return message.reply({
                content: 'all fields are mandatory in step 2',
            })
        }
    }



}

function setCMProperties(id, cmObject)
{
    const action = id.replace('cardmaker_', '').split('_')
    const command = action[0]
    const value = action[1]
    switch (command) {
        case 'button':
            cmObject.stage = value
            break
        case 'faction':
            cmObject.faction = value
            break
        case 'type':
            cmObject.type = value
            break
        case 'rarity':
            cmObject.rarity = value
            break
        case 'kredits':
            const kredits = parseInt(value)
            if (!isNaN(kredits)) cmObject.kredits = kredits
            break
        case 'attack':
            const attack = parseInt(value)
            if (!isNaN(attack)) cmObject.attack = attack
            break
        case 'defense':
            const defense = parseInt(value)
            if (!isNaN(defense)) cmObject.defense = defense
            break
        case 'operation':
            const operationCost = parseInt(value)
            if (!isNaN(operationCost)) cmObject.operationCost = operationCost
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
        let label = option.toUpperCase()
        if (type === 'kredits') label +='K'
        selectOptions.push({
            label: label,
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

    const rarityMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_rarity`)
        .setPlaceholder(`Select Rarity`)
        .addOptions(generateOptions( 'rarity', dictionary.rarity))
    selectMenus.push(rarityMenu)

    const typeMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_type`)
        .setPlaceholder(`Select Type`)
        .addOptions(generateOptions('type', dictionary.type))
    selectMenus.push(typeMenu)

    const kredits = []
    for (let i=0; i<16; i++) {
        kredits.push(i.toString())
    }
    const kreditsMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_kredits`)
        .setPlaceholder(`Select Kredits`)
        .addOptions(generateOptions('kredits', kredits))
    selectMenus.push(kreditsMenu)


    // Build action rows
    const actionRows = selectMenus.map(
        menu => new ActionRowBuilder().addComponents(menu)
    )


    const buttonRow = getButtonActionRow('cardmaker_button_step2', 'Next')
    actionRows.push(buttonRow)

    return actionRows
}

function getButtonActionRow(id, label)
{
    const button = new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)

    return new ActionRowBuilder().addComponents(button)
}

function getSecondStepRows()
{
    const selectMenus = []

    const kredits = []
    for (let i=0; i<7; i++) {
        kredits.push(i.toString())
    }

    const opCostMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_operation`)
        .setPlaceholder(`Select Operation Cost`)
        .addOptions(
            generateOptions('operation', kredits)
        )
    selectMenus.push(opCostMenu)

    const attacks = []
    for (let i=0; i<16; i++) {
        attacks.push(i.toString())
    }
    const attackMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_attack`)
        .setPlaceholder(`Select Attack`)
        .addOptions(
            generateOptions('attack', attacks)
        )
    selectMenus.push(attackMenu)

    const defenseMenu = new StringSelectMenuBuilder()
        .setCustomId(`cardmaker_defense`)
        .setPlaceholder(`Select Defense`)
        .addOptions(
            generateOptions('defense', attacks.slice(1))
        )
    selectMenus.push(defenseMenu)

    // Build action rows
    const actionRows = selectMenus.map(
        menu => new ActionRowBuilder().addComponents(menu)
    )


    const buttonRow = getButtonActionRow('cardmaker_button_step3', 'Next')
    actionRows.push(buttonRow)

    return actionRows
}

function getTextModal()
{
    // Create a modal
    const modal = new ModalBuilder()
        .setCustomId('cardmaker_button_title')
        .setTitle('Enter Title');

    // Create a text input field
    const textInput = new TextInputBuilder()
        .setCustomId('text_input_title')
        .setLabel('Enter Title')
        .setStyle(TextInputStyle.Short) // Single-line input
        .setPlaceholder('Type something...')
        .setRequired(true);

    // Add the text input to an action row
    const actionRow = new ActionRowBuilder().addComponents(textInput);

    // Add the action row to the modal
    modal.addComponents(actionRow)

    return modal
}

module.exports = {
    getFirstStepRows,
    handeInteraction,
}
