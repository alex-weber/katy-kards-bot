const bot = require("../controller/bot")
const {translate} = require("./translation/translator")
const {takeScreenshot} = require("./puppeteer")
const {getDeckFiles, deleteDeckFiles} = require("./fileManager")
const {getCardsDB} = require("../database/db")
const {deckBuilderLanguages} = require("../tools/language")

/**
 *
 * @param prefix
 * @param message
 * @param command
 * @param language
 * @returns {Promise<*>}
 */
async function createDeckImages(
    prefix,
    message,
    command,
    language)
{
    let urlLanguage = ''
    if (deckBuilderLanguages.includes(language)) urlLanguage = language + '/'
    const deckBuilderURL = 'https://www.kards.com/' + urlLanguage + 'decks/deck-builder?hash='
    const deckCode = command.replace(prefix, '')
    const hash = encodeURIComponent(deckCode)
    command = bot.parseCommand(prefix, command)
    let url
    let deckInfo = ''
    if (bot.isDeckLink(command)) {
        url = command
    } else {
        url = deckBuilderURL+hash
        deckInfo = '```' +
            translate(language, 'deck_code') +
            deckCode +
            '\n\n' +
            await analyseDeck(deckCode, language) +
            '```'
        if (!deckInfo) {
            await message.channel.send(translate(language, 'error'))
            return false
        }
    }
    let sentMessage = await message.channel.send(translate(language, 'screenshot'))
    sentMessage.react('🔄')
    const filename = await takeScreenshot(url)
    sentMessage.delete()
    if (!filename) {
        await message.channel.send(translate(language, 'error'))
        return false
    }
    const files = getDeckFiles(filename)
    sentMessage = await message.channel.send({content: deckInfo, files: files})
    console.log('Screenshot captured and sent successfully')

    deleteDeckFiles(filename)

    return sentMessage

}

/**
 *
 * @param deckCode
 * @param language
 * @returns {Promise<string>|false}
 */
async function analyseDeck(deckCode, language)
{
    const cardsCode = deckCode.slice(deckCode.indexOf('|')+1).replace(/;/g, '')
    const cards = splitByTwoChars(cardsCode)
    if (!cards) return false
    const cardsArray = deckCode.slice(deckCode.indexOf('|')+1).split(';')

    const dbCards = await getCardsDB({
        importId: {
            in: cards,
        },
    })

    return calculateAverages(dbCards, cardsArray, language)
}

function splitByTwoChars(str) {
    return str.match(/.{1,2}/g)
}

function getCardCount(importId, cardsArray) {

    for (let i = 0; i < cardsArray.length; i++) {
        if (cardsArray[i].includes(importId)) {
            return i + 1
        }
    }

    return 0
}

function calculateAverages(cards, cardsArray, language) {

    if (!cards) return false

    let totalAttack = 0
    let totalDefense = 0
    let totalKredits = 0
    let totalOperationCost = 0
    let units = 0
    let orders = 0
    let countermeasures = 0
    let infantry = 0
    let artillery = 0
    let bomber = 0
    let fighter = 0
    let tank = 0

    // Loop through each card and accumulate the values
    cards.forEach(card => {
        const amount = getCardCount(card.importId, cardsArray)
        if (card.type !== 'order' && card.type !== 'countermeasure')
        {
            if (card.type === 'infantry') infantry += amount
            if (card.type === 'artillery') artillery += amount
            if (card.type === 'bomber') bomber += amount
            if (card.type === 'fighter') fighter += amount
            if (card.type === 'tank') tank += amount
            totalAttack += card.attack * amount
            totalDefense += card.defense * amount
            totalOperationCost += card.operationCost * amount
            units += amount
        } else if (card.type === 'countermeasure') {
            countermeasures += amount
        } else if (card.type === 'order') {
            orders += amount
        }
        totalKredits += card.kredits
    })

    let averageAttack = 0
    let averageDefense = 0
    let averageOperationCost = 0

    if (units) {
        averageAttack = (totalAttack / units).toFixed(2)
        averageDefense = (totalDefense / units).toFixed(2)
        averageOperationCost = (totalOperationCost / units).toFixed(2)
    }

    const averageKredits = (totalKredits / cards.length).toFixed(2)

    let info = ''
    if (orders) info +=  translate(language, 'info_orders') + orders + '\n'
    if (countermeasures) info +=  translate(language, 'info_countermeasures') + countermeasures + '\n'

    if (units) info += '\n' + translate(language, 'info_units') + units + '\n'
    if (infantry) info +=  translate(language, 'info_infantry') + infantry + '\n'
    if (tank) info +=  translate(language, 'info_tanks') + tank + '\n'
    if (artillery) info +=  translate(language, 'info_artillery') + artillery + '\n'
    if (bomber) info +=  translate(language, 'info_bombers') + bomber + '\n'
    if (fighter) info +=  translate(language, 'info_fighters') + fighter + '\n'
    if (units) {
        info += '\n' +
            translate(language, 'averageAttack') + averageAttack + '\n' +
            translate(language, 'averageDefense') + averageDefense + '\n' +
            translate(language, 'averageOperationCost') + averageOperationCost + '\n'
    }

    return info + translate(language, 'averageKredits') + averageKredits + '\n'

}

module.exports = {createDeckImages, analyseDeck}