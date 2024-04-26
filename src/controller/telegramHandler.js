const {getLanguageByInput} = require("../tools/language")
const {getStats} = require("../tools/stats")
const bot = require("./bot")
const {getUser, updateUser, getSynonym} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {getCards, getFiles} = require("../tools/search")
const {getMediaGroup} = require("../clients/telegram")
const globalLimit = parseInt(process.env.LIMIT) || 10 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 256 // buffer overflow protection :)
const maxFileSize = 5*1024*1024 //5MB
const defaultPrefix = process.env.DEFAULT_PREFIX || '!'
const {getDeckFiles, deleteDeckFiles} = require("../tools/fileManager")
const {takeScreenshot} = require("../tools/puppeteer")
/**
 *
 * @param ctx
 * @returns {Promise<*>}
 */
async function telegramHandler(ctx) {
    let prefix = defaultPrefix
    let command = ctx.update.message.text
    if (!command.startsWith(prefix) ||
        ctx.update.message.from.is_bot ||
        command.length > maxStrLen) return
    let language = getLanguageByInput(command)
    //online players
    if (command === prefix+prefix) return ctx.reply(await getStats(language))
    //set attachment limit to 10 if it is a private chat
    let limit = globalLimit
    if (ctx.update.message.chat.type === 'private') limit = 10
    console.log(ctx.update.message.from)
    command = bot.parseCommand(prefix, command)
    //get or create user
    let userID = ctx.update.message.from.id.toString()
    const user = await getUser(userID)
    //switch language
    if (bot.isLanguageSwitch(command))
    {
        language = await bot.switchLanguage(user, command)
        ctx.reply(
            translate(language, 'langChange') + language.toUpperCase()
        ).then(() =>
        {
            console.log('lang changed to', language.toUpperCase(), 'for',
                ctx.update.message.from.username)
        })

        return
    }
    //update user
    if (!user.name) user.name = ctx.update.message.from.first_name
    //change user language to RU if cyrillic is detected
    if (language === 'ru') user.language = language
    else if (user.language !== language) language = user.language
    await updateUser(user)
    //help
    if (command === 'help') return ctx.reply(translate(language, 'help'))
    //search
    if (!command.length) return
    if (command.length < minStrLen) return ctx.reply('minimum 2 characters, please')
    //deck images
    //show Deck as images
    if (bot.isDeckLink(command) || bot.isDeckCode(command))
    {
        const deckBuilderURL = 'https://www.kards.com/decks/deck-builder?hash='
        const hash = encodeURIComponent(ctx.update.message.text.replace(prefix, ''))
        let url = bot.isDeckLink(command) ? command : deckBuilderURL+hash
        ctx.reply(translate(language, 'screenshot'))
        let result = await takeScreenshot(url)
        if (!result) return ctx.reply(translate(language, 'error'))
        const files = getDeckFiles()
        ctx.replyWithPhoto({ source: files[1] })
        console.log('Screenshot captured and sent successfully')
        //deleteDeckFiles()

        return
    }
    //check for synonyms
    let syn = await getSynonym(command)
    if (syn)
    {
        //check if there is an image link
        if (syn.value.startsWith('https'))
        {
            try {
                const fileSize = await bot.getFileSize(syn.value)
                if (fileSize && fileSize < maxFileSize) return ctx.replyWithPhoto(syn.value)
                else return ctx.reply(translate(language, 'error'))

            } catch (e) {
                console.log(e)
                return ctx.reply(translate(language, 'error'))
            }
        }
        //check if it should reply with a text message
        if (syn.value.startsWith('text:')) return ctx.reply(syn.value.replace('text:', ''))
        //else use the value as command
        command = syn.value
    }
    let variables = {
        language: language,
        q: command,
        showSpawnables: true,
        showReserved: true,
    }
    let searchResult = await getCards(variables)
    if (!searchResult) return
    if (!searchResult.counter) return ctx.reply(translate(language, 'noresult'))
    let files = getFiles(searchResult, language, limit)
    console.log(files)
    ctx.reply(translate(language, 'search') + ': ' + searchResult.counter)
    if (searchResult.counter > 1)
    {
        try {
            return ctx.replyWithMediaGroup(getMediaGroup(files))
        } catch (e) {
            console.log(e)
            return ctx.reply(translate(language, 'error'))
        }
    }
    else if (searchResult.counter === 1)
    {
        try {

            return ctx.replyWithPhoto(
                files[0].attachment + '?' + bot.getCurrentTimestamp(),
                { caption: files[0].description }).
            then((m) => {
                /*ctx.telegram.setMessageReaction(
                    m.chat.id,
                    m.message_id,
                    [{'type':'emoji', 'emoji':'👍' }]
                )*/
                console.log(m.message_id)
            })
        }
        catch (e) {
            console.log(e)
            return ctx.reply(translate(language, 'error'))
        }
    }
}

module.exports = {telegramHandler}