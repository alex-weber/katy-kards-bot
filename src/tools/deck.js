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
    const counts = readDeckCounts(deckCode.slice(deckCode.indexOf('|')+1))
    if (!counts.size) return false

    const dbCards = await getCardsDB({
        importId: {
            in: [...counts.keys()],
        },
    })

    return calculateAverages(dbCards, counts, language)
}

/**
 * How many copies of each card the deck holds, keyed by importId.
 *
 * A deck code lists its cards in `;`-separated groups, and a card's group says
 * how many copies it runs: the first group one copy each, the second two, and
 * so on. Ids are two characters and are read one group at a time — reading
 * them out of the groups concatenated meant a single odd-length group would
 * shift every id after it by one character. A well-formed code names each card
 * once.
 *
 * @param body the deck code after the '|'
 * @returns {Map<string, number>}
 */
function readDeckCounts(body) {
    const counts = new Map()

    body.split(';').forEach((group, index) => {
        for (const importId of group.match(/.{1,2}/g) || []) {
            //a leftover single character means the group was not a whole
            //number of ids; counting it would be inventing a card
            if (importId.length < 2) {
                console.error('Ignored a trailing character in a deck code group:', group)
                continue
            }
            counts.set(importId, index + 1)
        }
    })

    return counts
}

function calculateAverages(cards, counts, language) {

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

    // importId does not identify a row: only cardId is unique, so a card
    // reprinted under a second cardId comes back twice and every copy of it
    // used to be counted twice with it.
    const counted = new Set()

    // Loop through each card and accumulate the values
    cards.forEach(card => {
        const amount = counts.get(card.importId) || 0
        if (!amount || counted.has(card.importId)) return
        counted.add(card.importId)

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
        //every copy costs its kredits, so the deck's average is over copies
        totalKredits += card.kredits * amount
    })

    //a card in the code that no row answered for: the stats below are missing
    //it entirely, which is worth knowing when a count looks wrong
    const missing = [...counts.keys()].filter(importId => !counted.has(importId))
    if (missing.length) {
        console.error('Deck code names cards that are not in the database:', missing.join(' '))
    }

    let averageAttack = 0
    let averageDefense = 0
    let averageOperationCost = 0

    if (units) {
        averageAttack = (totalAttack / units).toFixed(2)
        averageDefense = (totalDefense / units).toFixed(2)
        averageOperationCost = (totalOperationCost / units).toFixed(2)
    }

    const totalCards = units + orders + countermeasures
    const averageKredits = (totalCards ? totalKredits / totalCards : 0).toFixed(2)

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

module.exports = {createDeckImages, analyseDeck, readDeckCounts}