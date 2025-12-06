const {getLanguageByInput, deckBuilderLanguages} = require("../tools/language")
const {getStats} = require("../tools/stats")
const bot = require("./bot")
const {getUser, updateUser, getSynonym} = require("../database/db")
const {translate} = require("../tools/translation/translator")
const {getCards, getFiles} = require("../tools/search")
const {getMediaGroup, Input} = require("../clients/telegram")
const globalLimit = parseInt(process.env.LIMIT) || 10 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 256 // buffer overflow protection :)
const maxFileSize = 5*1024*1024 //5MB
const defaultPrefix = process.env.DEFAULT_PREFIX || '!'
const {getDeckFiles, deleteDeckFiles} = require("../tools/fileManager")
const {takeScreenshot} = require("../tools/puppeteer")
const cacheKeyPrefix = process.env.NODE_ENV === 'production' ? '' : 'dev:'
const {uploadImage, downloadImageAsFile, convertImageToWEBP} = require("../tools/imageUpload")
const Fs = require("@supercharge/fs")
const {analyseDeck} = require("../tools/deck")

/**
 *
 * @param ctx
 * @param redis
 * @returns {Promise<*>}
 */
async function telegramHandler(ctx, redis) {
    let prefix = defaultPrefix
    let command = ctx.update.message.text
    if (!command.startsWith(prefix) ||
        ctx.update.message.from.is_bot ||
        command.length > maxStrLen) return
    let language = getLanguageByInput(command)
    //set attachment limit to 10 if it is a private chat
    let limit = globalLimit
    if (ctx.update.message.chat.type === 'private') limit = 10
    console.log(ctx.update.message.from)
    command = bot.parseCommand(prefix, command)
    //get or create user
    const userID = ctx.update?.message?.from?.id?.toString() || null
    if (!userID) return
    //try to get from cache
    const user = await getUser(userID)

    if (user.status !== 'active') {
        console.log('banned user' , user, command)

        return
    }

    //switch language
    if (bot.isLanguageSwitch(command))
    {
        language = await bot.switchLanguage(user, command)
        return ctx.reply(translate(language, 'langChange') + language.toUpperCase())
    }
    //update user
    if (!user.name) user.name = ctx.update.message.from.first_name
    //change user language to RU if cyrillic is detected
    if (language === 'ru') user.language = 'ru'
    else language = user.language
    await updateUser(user)
    //online players
    if (ctx.update.message.text === prefix+prefix) return ctx.reply(await getStats(language))
    //help
    if (command === 'help') return ctx.reply(translate(language, 'help'))
    if (!command.length) return //do nothing if it's just the prefix !
    if (command.length < minStrLen) return ctx.reply(translate(language, 'min'))
    //deck image
    if (bot.isDeckLink(command) || bot.isDeckCode(command))
    {
        command = bot.getDeckCode(ctx.update.message.text)
        //check if in cache
        const deckKey = cacheKeyPrefix + 'deck:'+language+':' + command
        if (await redis.exists(deckKey))
        {
            const response = await redis.json.get(deckKey, '$')
            console.log('serving deck from cache', deckKey)
            await ctx.reply(response.content.replaceAll('```', ''))
            await ctx.replyWithPhoto(response.files[1])

            return
        }
        //const deckCode = command.replace(prefix, '')
        const deckInfo = await analyseDeck(command, language)
        if (!deckInfo) return ctx.reply(translate(language, 'error'))

        //check if screenshot capturing is running, ask user to wait
        const screenshotKey = cacheKeyPrefix + 'screenshot'
        if (await redis.exists(screenshotKey))
        {
            return ctx.reply(translate(language, 'screenshotRunning'))
        }
        await redis.set(screenshotKey, 'running')
        redis.expire(screenshotKey, 120) //delete screenshot lock key after 120 seconds anyway

        let deckBuilderLang = ''
        if (deckBuilderLanguages.includes(language)) deckBuilderLang = language + '/'
        const deckBuilderURL = 'https://www.kards.com/' +
            deckBuilderLang+ 'decks/deck-builder?hash='
        const hash = encodeURIComponent(command)
        const url = bot.isDeckLink(bot.parseCommand(prefix, command)) ?
            bot.parseCommand(prefix, command) :
            deckBuilderURL+hash
        ctx.reply(translate(language, 'screenshot'))

        await takeScreenshot(url)
        redis.del(screenshotKey)
        console.log('createDeckImages finished')
        const files = getDeckFiles()

        await ctx.replyWithPhoto({ source: files[0] })
        await ctx.reply(deckInfo.replaceAll('```', ''))
        await ctx.replyWithPhoto({ source: files[1] })

        //upload them for caching
        const expiration = parseInt(process.env.DECK_EXPIRATION) || 3600*24*30 //30 days by default

        const file1 = await uploadImage(files[0], expiration)
        const file2 = await uploadImage(files[1], expiration)
        if (file1 && file2)
        {
            const uploadedFiles = [file1, file2]
            //check if they are uploaded & are served correctly
            const file1size = await bot.getFileSize(file1)
            const file2size = await bot.getFileSize(file2)
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

        return
    }
    //check for synonyms
    let syn = await getSynonym(command)
    if (syn)
    {
        if (syn.value.startsWith('{')) {
            const m = JSON.parse(syn.value)
            if (m.content) syn.value = m.content
            if (m.files) syn.value = m.files[0]
        }
        //check if there is an image link
        if (syn.value.startsWith('https'))
        {
            try {
                const fileSize = await bot.getFileSize(syn.value)
                if (fileSize && fileSize < maxFileSize)
                {
                    //we need a different method for gif images
                    if(syn.value.endsWith('.gif'))
                        return ctx.replyWithAnimation(syn.value)
                    //reply with a static image
                    return ctx.replyWithPhoto(syn.value)
                }
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
    let cards = await getCards(variables)
    if (!cards) return
    if (!cards.counter) return ctx.reply(translate(language, 'noresult'))
    let files = getFiles(cards, language, limit)

    ctx.reply(translate(language, 'search') + ': ' + cards.counter)

    //convert avif to webp
    for (const file of files) {
        try {
            const path = await downloadImageAsFile(file.attachment, language)
            file.attachment = await convertImageToWEBP(path)
        } catch (e) {
            console.error(e)
            return ctx.reply(translate(language, 'error'))
        }
    }

    if (cards.counter > 1)
    {
        try {
            return ctx.replyWithMediaGroup(getMediaGroup(files))
        } catch (e) {
            console.log(e)
            return ctx.reply(translate(language, 'error'))
        }
    }
    else if (cards.counter === 1)
    {
        try {

            return ctx.replyWithPhoto(
                Input.fromLocalFile(files[0].attachment),
                { caption: files[0].description }
            )
        }
        catch (e) {
            console.log(e)
            return ctx.reply(translate(language, 'error'))
        }
    }
}

module.exports = {telegramHandler}