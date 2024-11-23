const bot = require("../controller/bot")
const {translate} = require("./translation/translator")
const {takeScreenshot} = require("./puppeteer")
const {getDeckFiles, deleteDeckFiles} = require("./fileManager")
const {uploadImage} = require("./imageUpload")
const Fs = require("@supercharge/fs")
const {getCardsDB} = require("../database/db")

/**
 *
 * @param prefix
 * @param message
 * @param command
 * @param language
 * @param redis
 * @param deckKey
 * @returns {Promise<*>}
 */
async function createDeckImages(
    prefix,
    message,
    command,
    language,
    redis,
    deckKey)
{

    const deckBuilderURL = 'https://www.kards.com/decks/deck-builder?hash='
    const deckCode = command.replace(prefix, '')
    const hash = encodeURIComponent(deckCode)
    command = bot.parseCommand(prefix, command)
    let url
    let deckInfo = ''
    if (bot.isDeckLink(command)) {
        url = command
    } else {
        url = deckBuilderURL+hash
        deckInfo = await analyseDeck(deckCode, language)
        if (!deckInfo) return message.channel.send(translate(language, 'error'))
    }
    message.channel.send(translate(language, 'screenshot'))
    let result = await takeScreenshot(url)
    if (!result) return message.channel.send(translate(language, 'error'))
    let files = getDeckFiles()
    message.channel.send({content: deckInfo, files: files})
    console.log('Screenshot captured and sent successfully')

    //upload them for caching
    const expiration = 604800 //7 days
    let file1 = await uploadImage(files[0], expiration)
    let file2 = await uploadImage(files[1], expiration)
    if (file1 && file2)
    {
        let uploadedFiles = [file1, file2]
        //check if they are uploaded & are served correctly
        let file1size = await bot.getFileSize(file1)
        let file2size = await bot.getFileSize(file2)
        if ( await Fs.size(files[0]) === file1size &&
            await Fs.size(files[1]) === file2size)
        {
            const cached = {
                content: deckInfo,
                files: uploadedFiles
            }
            await redis.json.set(deckKey, '$', cached)
            redis.expire(deckKey, expiration)
            console.log('setting cache key for deck', command)
            deleteDeckFiles()
        }
    }
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

    // Loop through each card and accumulate the values
    cards.forEach(card => {
        const amount = getCardCount(card.importId, cardsArray)
        if (card.type !== 'order' && card.type !== 'countermeasure')
        {
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

    const info = '```' +
        translate(language, 'units') + units + '\n' +
        translate(language, 'orders') + orders + '\n' +
        translate(language, 'countermeasures') + countermeasures + '\n' +
        translate(language, 'averageAttack') + averageAttack + '\n' +
        translate(language, 'averageDefense') + averageDefense + '\n' +
        translate(language, 'averageKredits') + averageKredits + '\n' +
        translate(language, 'averageOperationCost') + averageOperationCost + '\n' +
        '```'

    return info
}

module.exports = {createDeckImages}