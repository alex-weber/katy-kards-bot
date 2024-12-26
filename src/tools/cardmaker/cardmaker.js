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
    const command = interaction.values ? interaction.values[0] : interaction.customId

    const cmKey = 'card_maker:' + interaction.user.id
    let cmObject = await redis.json.get(cmKey, '$')

    if (!cmObject) cmObject = getDefaultCMObject()

    cmObject = setCMProperties(command, cmObject)
    await redis.json.set(cmKey, '$', cmObject)

    if (!interaction.isModalSubmit() && !interaction.isButton())
    {
        await interaction.deferUpdate() //end it properly
    }

    if (interaction.isModalSubmit() && interaction.customId === 'cardmaker_button_title')
    {
        const title = interaction.fields.getTextInputValue('text_input_title')
        const text = interaction.fields.getTextInputValue('text_input_text')
        cmObject.title = title
        cmObject.text = text
        cmObject.stage = 'upload'
        await redis.json.set(cmKey, '$', cmObject)

        interaction.reply({
            content: 'Upload your image',
            ephemeral: true,
        })

    }


    if (interaction.customId === 'cardmaker_button_step2')
    {
        if (!cmObject.faction || !cmObject.type || !cmObject.kredits || !cmObject.rarity)
        {
            interaction.reply({
                content: 'Nuh Uh!',
                ephemeral: true,
            })
        } else
        {
            if (cmObject.type === 'order' || cmObject.type === 'countermeasure') {

                interaction.showModal(
                    getTextModal()
                )
            } else
            {
                interaction.reply({
                    content: 'Enter additional data',
                    components: getSecondStepRows(),
                    ephemeral: true,
                })
            }
        }

    }

    if (interaction.customId === 'cardmaker_button_step3')
    {
        if (cmObject.operationCost === null || cmObject.attack === null || !cmObject.defense)
        {
            interaction.reply({
                content: 'Nuh Uh!',
                ephemeral: true,
            })
        } else {
            interaction.showModal(
                getTextModal()
            )
        }

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

function getTextModal()
{
    // Create a modal
    const modal = new ModalBuilder()
        .setCustomId('cardmaker_button_title')
        .setTitle('Enter Title and Text')

    // Create a text input field
    const title = new TextInputBuilder()
        .setCustomId('text_input_title')
        .setLabel('Enter Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type something...')
        .setRequired(true);

    // Create a text input field
    const the_text = new TextInputBuilder()
        .setCustomId('text_input_text')
        .setLabel('Enter Text')
        .setStyle(TextInputStyle.Paragraph) // Single-line input
        .setPlaceholder('Type something...')
        .setRequired(true);

    // Add the text input to an action row
    const actionRowTitle = new ActionRowBuilder().addComponents(title)
    const actionRowText = new ActionRowBuilder().addComponents(the_text)

    // Add the action row to the modal
    modal.addComponents(actionRowTitle, actionRowText)

    return modal
}

module.exports = {
    getFirstStepRows,
    handeInteraction,
}
