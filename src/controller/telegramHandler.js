const {getLanguageByInput, deckBuilderLanguages} = require("../tools/language")
const {getStats} = require("../tools/stats")
const bot = require("./bot")
const {getUser, updateUser, getSynonym, createMessage} = require("../database/db")
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
const {downloadImageAsFile, convertImageToWEBP} = require("../tools/imageUpload")
const {analyseDeck} = require("../tools/deck")
const fs = require('fs').promises
const path = require('path')

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
    //set the attachment limit to 10 if it is a private chat
    let limit = globalLimit
    if (ctx.update.message.chat.type === 'private') limit = 10

    command = bot.parseCommand(prefix, command)

    //get or create the user
    const userID = ctx.update?.message?.from?.id?.toString() || null
    if (!userID) return
    //try to get from the cache
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

    let chatName = ctx.update?.message?.chat?.title || 'private'
    let commandToSave = `Telegram | ${chatName} | -> ${command}`
    //save the message
    createMessage({authorId: user.id, content: commandToSave}).then()

    //online players
    if (ctx.update.message.text === prefix+prefix) return ctx.reply(await getStats(language))

    //help
    if (command === 'help') return ctx.reply(translate(language, 'help'))

    if (!command.length) return //do nothing if it's just the prefix
    if (command.length < minStrLen) return ctx.reply(translate(language, 'min'))

    //deck image
    if (bot.isDeckLink(command) || bot.isDeckCode(command))
    {
        command = bot.getDeckCode(ctx.update.message.text)
        //check if the deck is already in the cache
        const deckKey = cacheKeyPrefix + 'deck:'+language+':' + command
        if (await redis.exists(deckKey))
        {
            const response = await redis.json.get(deckKey, '$')
            console.log('serving deck from cache', deckKey)
            await ctx.replyWithPhoto(response.files[0])
            await ctx.reply(response.content.replaceAll('```', ''))
            await ctx.replyWithPhoto(response.files[1])

            return
        }

        const deckInfo = await analyseDeck(command, language)
        if (!deckInfo) return ctx.reply(translate(language, 'error'))

        // check if the screenshot capturing is running, ask the user to wait if so
        const screenshotKey = cacheKeyPrefix + 'screenshot'

        if (await redis.exists(screenshotKey)) {
            return ctx.reply(translate(language, 'screenshotRunning'))
        }

        // lock the screenshot process
        await redis.set(screenshotKey, 'running')
        redis.expire(screenshotKey, 120) // auto-expire after 120 seconds

        let deckBuilderLang = ''
        if (deckBuilderLanguages.includes(language)) deckBuilderLang = language + '/'
        const deckBuilderURL = 'https://www.kards.com/' + deckBuilderLang + 'decks/deck-builder?hash='

        const hash = encodeURIComponent(command)
        const url = bot.isDeckLink(bot.parseCommand(prefix, command))
            ? bot.parseCommand(prefix, command)
            : deckBuilderURL + hash

        // send the message that screenshot is running and store ID
        const runningMsg = await ctx.reply(translate(language, 'screenshot'))
        const runningMsgId = runningMsg.message_id

        let filename;

        try {
            filename = await takeScreenshot(url)
            console.log('createDeckImages finished')

            if (filename) {
                const files = getDeckFiles(filename)
                await ctx.replyWithPhoto({ source: files[0] })
                await ctx.reply(deckInfo.replaceAll('```', ''))
                await ctx.replyWithPhoto({ source: files[1] })
            } else {
                await ctx.reply(translate(language, 'error'))
            }

        } finally {
            // cleanup redis lock
            redis.del(screenshotKey)

            // delete the "screenshot running" message from the chat
            try {
                await ctx.deleteMessage(runningMsgId)
            } catch (err) {
                console.error('Failed to delete status message:', err)
            }

            if (filename) {
                deleteDeckFiles(filename)
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
                    //we need a different method for GIF images
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
        if (syn.value.startsWith('text:')) return ctx.reply(syn.value.replace('text:', '').replaceAll('```', ''))
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

    const downloadedFiles = []
    const telegramCachePrefix = 'telegram:card:'

    try {
        // convert avif to webp
        for (const file of files) {
            try {
                const cacheKey = cacheKeyPrefix + telegramCachePrefix + file.attachment

                // Check if Telegram file_id is already cached
                const cachedFileId = await redis.get(cacheKey)

                if (cachedFileId) {
                    file.attachment = cachedFileId
                    file.isTelegramFileId = true
                    continue
                }

                // Build the expected webp path based on URL
                const fileName = path.basename(file.attachment.split('?')[0])
                const languageFileName = language + '_' + fileName
                const expectedWebpPath = path.join(
                    __dirname,
                    '../tmp/downloads',
                    `${path.parse(languageFileName).name}.webp`
                )

                let webpExists = false

                try {
                    const stats = await fs.stat(expectedWebpPath)
                    webpExists = stats.isFile() && stats.size > 0
                } catch (err) {
                    // File doesn't exist
                }
                //keep the original attachment URL for later use
                file.originalAttachmentUrl = file.attachment

                if (webpExists) {
                    file.attachment = expectedWebpPath
                } else {
                    const downloadedPath = await downloadImageAsFile(file.attachment, language)

                    downloadedFiles.push(downloadedPath)

                    file.attachment = await convertImageToWEBP(downloadedPath)
                }
            } catch (e) {
                console.error(e)
                return ctx.reply(translate(language, 'error'))
            }
        }

        if (cards.counter > 1) {
            try {
                const sentMessages = await ctx.replyWithMediaGroup(
                    getMediaGroup(files)
                )

                // Cache only newly uploaded files
                for (let i = 0; i < files.length; i++) {
                    const file = files[i]

                    if (file.isTelegramFileId) continue

                    const sentMessage = sentMessages[i]

                    if (!sentMessage?.photo?.length) continue

                    const largestPhoto =
                        sentMessage.photo[sentMessage.photo.length - 1]

                    const cacheKey =
                        cacheKeyPrefix + telegramCachePrefix + file.originalAttachmentUrl

                    await redis.set(cacheKey, largestPhoto.file_id)
                    await redis.expire(cacheKey, process.env.REDIS_EXP_TELEGRAM || 60 * 60 * 24 * 90) // 90 days
                }

                return sentMessages
            } catch (e) {
                console.log(e)
                return ctx.reply(translate(language, 'error'))
            }
        }

        if (cards.counter === 1) {
            try {
                const file = files[0]

                // Already uploaded before -> send by file_id
                if (file.isTelegramFileId) {
                    console.log('Sending image by file_id:', file.attachment)
                    return ctx.replyWithPhoto(file.attachment, {
                        caption: file.description
                    })
                }

                // Upload new image
                const sentMessage = await ctx.replyWithPhoto(
                    Input.fromLocalFile(file.attachment),
                    {
                        caption: file.description
                    }
                )

                // Store largest photo file_id
                if (sentMessage.photo?.length) {
                    const largestPhoto =
                        sentMessage.photo[sentMessage.photo.length - 1]

                    const cacheKey =
                        cacheKeyPrefix + 'telegram:card:' + file.originalAttachmentUrl

                    await redis.set(cacheKey, largestPhoto.file_id)
                    await redis.expire(cacheKey, process.env.REDIS_EXP_TELEGRAM || 60 * 60 * 24 * 90) // 90 days
                }

                return sentMessage
            } catch (e) {
                console.log(e)
                return ctx.reply(translate(language, 'error'))
            }
        }
    } finally {
        for (const filePath of downloadedFiles) {
            try {
                await fs.unlink(filePath)
            } catch (err) {
                console.error('Error cleaning up downloaded file:', err)
            }
        }
    }
}

module.exports = {telegramHandler}