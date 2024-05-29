const {deckBuilderLanguages} = require("./language")
const bot = require("../controller/bot")
const {translate} = require("./translation/translator")
const {takeScreenshot} = require("./puppeteer")
const {getDeckFiles} = require("./fileManager")
const {uploadImage} = require("./imageUpload")
const Fs = require("@supercharge/fs")

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
async function createDeckImages(prefix, message, command, language, redis, deckKey)
{
    let deckBuilderLang = ''
    if (deckBuilderLanguages.includes(language)) deckBuilderLang = language + '/'
    const deckBuilderURL = 'https://www.kards.com/' +
        deckBuilderLang+ 'decks/deck-builder?hash='
    const hash = encodeURIComponent(message.content.replace(prefix, ''))
    let url = bot.isDeckLink(command) ? command : deckBuilderURL+hash
    message.reply(translate(language, 'screenshot'))
    let result = await takeScreenshot(url)
    if (!result) return message.reply(translate(language, 'error'))
    let files = getDeckFiles()
    message.reply({files: files})
    console.log('Screenshot captured and sent successfully')
    //upload them for caching
    const expiration = 2592000 //30 days
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
            await redis.json.set(deckKey, '$', uploadedFiles)
            redis.expire(deckKey, expiration)
            console.log('setting cache key for deck', command)
        }
    }
}

module.exports = {createDeckImages}