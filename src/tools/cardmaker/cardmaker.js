const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
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
        stage: 'step1',
    }
}

/**
 *
 * @param interaction
 * @param redis
 * @returns {Promise<void>}
 */
async function handeInteraction(interaction, redis)
{
    let command = ''
    if (interaction.values) {
        command = 'cardmaker_' + interaction.values[0]
    } else {
        command = interaction.customId
    }

    const cmKey = 'card_maker:' + interaction.user.id
    let cmObject = getDefaultCMObject()

    const cachedCMObject = await redis.json.get(cmKey, '$')

    if (cachedCMObject)
    {
       cmObject = cachedCMObject
    }
    cmObject = setCMProperties(command, cmObject)
    await redis.json.set(cmKey, '$', cmObject)

    if (!interaction.isModalSubmit() && !interaction.isButton())
    {
        await interaction.deferUpdate() //end it properly
    }

    if (interaction.isModalSubmit() && interaction.customId === 'cardmaker_button_title')
    {
        const userInput = interaction.fields.getTextInputValue('text_input_title')
        cmObject.title = userInput
        cmObject.stage = 'stage4'
        await redis.json.set(cmKey, '$', cmObject)
        interaction.reply({
            content: interaction.customId +'\n' + JSON.stringify(cmObject),
            ephemeral: true,
        })

    }
    if (interaction.customId === 'cardmaker_button_text')
    {

        cmObject.text = interaction.fields.getTextInputValue('text_input_text')
        cmObject.stage = 'stage5'
        await redis.json.set(cmKey, '$', cmObject)
        interaction.reply({
            content: interaction.customId +'\n' + JSON.stringify(cmObject),
            ephemeral: true,
        })

    }


    if (interaction.customId === 'cardmaker_button_step2')
    {
        if (cmObject.type === 'order' || cmObject.type === 'countermeasure') {

            interaction.showModal(getTextModal('title'), TextInputStyle.Short)
        } else {
            interaction.reply({
                content: interaction.customId +'\n' + JSON.stringify(cmObject),
                components: getSecondStepRows(),
                ephemeral: true,
            })
        }

    }

    if (interaction.customId === 'cardmaker_button_step3')
    {
        interaction.showModal(
            getTextModal('title', TextInputStyle.Short)
        )
    }


}

function setCMProperties(id, cmObject)
{
    const action = id.replace('cardmaker_', '').split('_')
    const command = action[0]
    const value = action[1]
    switch (command) {
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

function getTextModal(id, style)
{
    // Create a modal
    const modal = new ModalBuilder()
        .setCustomId('cardmaker_button_' + id)
        .setTitle('Enter Title');

    // Create a text input field
    const textInput = new TextInputBuilder()
        .setCustomId('text_input_'  + id)
        .setLabel('Enter ' + id.toUpperCase())
        .setStyle(style) // Single-line input
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
