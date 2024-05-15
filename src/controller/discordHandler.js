const bot = require("./bot")
const {
    getUser,
    updateUser,
    getTopDeckStats,
    getSynonym,
    getAllSynonyms,
    createMessage,
    getMessages,
} = require("../database/db")
const {
    getLanguageByInput,
    APILanguages,
    deckBuilderLanguages,
} = require("../tools/language")
const {translate} = require("../tools/translation/translator")
const {takeScreenshot} = require("../tools/puppeteer")
const {uploadImage} = require("../tools/imageUpload")
const {myTDRank} = require("../games/topDeck")
const {handleTD} = require("../games/topDeckController")
const {getStats, getServerList} = require("../tools/stats")
const {
    isManager, isBotCommandChannel,
    listSynonyms, handleSynonym,
    getCards, getFiles,
} = require("../tools/search")
const dictionary = require("../tools/dictionary")
const {getDeckFiles} = require("../tools/fileManager")
const {getRandomImage} = require("../tools/nekosAPI")
const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 4000 // buffer overflow protection :)
const maxFileSize = 5 * 1024 * 1024 //5MB
const Fs = require('@supercharge/fs')
let cacheKeyPrefix = process.env.NODE_ENV === 'production' ? '' : 'dev:'
/**
 *
 * @param message
 * @param client
 * @param redis
 * @returns {Promise<*>}
 */
async function discordHandler(message, client, redis)
{
    if (message.author.bot || message.content.length > maxStrLen) return
    //get a custom sever prefix if set
    let prefix = bot.getPrefix(message)
    //is there a "bot command" marked with double quotation marks?
    let qSearch = bot.isQuotationSearch(message)
    if (qSearch)
    {
        //rewrite the message content with only needed information
        message.content = qSearch
        console.log('bot command with quotes inside a message:', message.content)
    }
    //not a bot command or bot
    else if (!message.content.startsWith(prefix)) return

    //check for write permissions
    console.time('permissions')
    const permitted = await bot.hasWritePermissions(client, message, redis)
    if (message.guildId && !permitted)
    {
        console.timeEnd('permissions')
        return
    }
    console.timeEnd('permissions')

    //it's a bot command
    //create the DM channel
    await message.author.createDM()
    let guildName = ''
    let channelName = ''
    if (message.guildId)
    {
        guildName = message.guild.name
        channelName = message.channel.name
    }
    console.log('bot command:', guildName, channelName,
        message.author.username, '->', message.content)

    //remove all the prefixes from the beginning
    let command = bot.parseCommand(prefix, message.content)
    if (!command.length) return
    //set username
    console.time('getUser')
    let user
    const userId = message.author.id.toString()
    const userKey = cacheKeyPrefix + 'user:' + userId
    let cachedUser = await redis.json.get(userKey, '$')
    if (!cachedUser || !cachedUser.hasOwnProperty('id'))
    {
        console.log('no user in cache, caching')
        user = await getUser(message.author.id.toString())
        await redis.json.set(userKey, '$', user)
    } else
    {
        console.log('getting user from cache')
        user = cachedUser
    }
    console.timeEnd('getUser')
    //check the status
    if (user.status !== 'active')
    {
        return console.log('blocked user\n', user)
    }
    if (!user.name) user.name = message.author.username
    //set the user language
    let language = user.language
    if (getLanguageByInput(command) === 'ru' && language !== 'ru')
    {
        user.language = 'ru'
        console.time('updateUser')
        await updateUser(user)
        //change user language to ru
        await redis.json.set(userKey, '$.language', 'ru')
        console.timeEnd('updateUser')
        language = 'ru'
    }
    //save the command in the DB Message table
    let messages = await getMessages(user.id)
    if(messages.length)
    {
        console.log(messages[0].content)
    }
    await createMessage({authorId: user.id, content: command})

    //show Deck as images
    if (bot.isDeckLink(command) || bot.isDeckCode(command))
    {
        //check if in cache
        let deckKey = cacheKeyPrefix + 'deck:'+language+':' + command
        let files
        if (await redis.exists(deckKey))
        {
            files = await redis.json.get(deckKey, '$')
            message.reply(translate(language, 'cache'))
            console.log('got deck images from cache')
            return message.reply({files: files})
        }
        let deckBuilderLang = ''
        if (deckBuilderLanguages.includes(language)) deckBuilderLang = language + '/'
        const deckBuilderURL = 'https://www.kards.com/' +
            deckBuilderLang+ 'decks/deck-builder?hash='
        const hash = encodeURIComponent(message.content.replace(prefix, ''))
        let url = bot.isDeckLink(command) ? command : deckBuilderURL+hash
        message.reply(translate(language, 'screenshot'))
        let result = await takeScreenshot(url)
        if (!result) return message.reply(translate(language, 'error'))
        files = getDeckFiles()
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

        return
    }

    //show online stats
    if (command === 'ingame' || command === 'online')
    {
        let stats = await getStats(language)
        return message.reply(stats)
    }

    //switch language
    if (bot.isLanguageSwitch(command) && !qSearch)
    {
        language = await bot.switchLanguage(user, command)
        user.language = language
        await redis.json.set(userKey, '$.language', language)
        return message.reply(translate(language, 'langChange') + language.toUpperCase())
    }

    //handle command
    if (command === 'help') return message.reply(translate(language, 'help'))

    //clear cache
    if (command === 'cclear' && isManager(user))
    {
        redis.FLUSHDB('ASYNC', (err, succeeded) =>
        {
            console.log(succeeded)
        })
        return message.reply('cache cleared')
    }

    if (command === 'sync' && isManager(user))
    {
        const spawn = require('child_process').spawn
        const child = spawn('node', ['src/tools/sync.js'],
            { stdio: ['inherit', 'inherit', 'inherit', 'ipc']})
        message.reply('starting DB sync...')
        child.on('close', function(code) {
            //Here you can get the exit code of the script
            console.log('sync closing code: ' + code)
            if (code === 0) return message.reply('DB sync done')
        })
        child.on('message', function(stats) {
            //console.log('message from child: ' + count)
            if (stats.current%100 === 0 || stats.current >= stats.total)
            {
                message.reply(`${stats.current}/${stats.total} ${stats.percentDone}% of cards updated`)
            }
        })
        child.on('error', function(error) {
            console.log(error)
        })

        return
    }

    //get top 9 TD ranking
    if (command.startsWith('ranking')) return message.reply(await getTopDeckStats())

    //user's TD ranking
    if (command === 'myrank')
    {
        return message.reply(myTDRank(user))
    }

    //top deck game only in special channels
    if (command.startsWith('td') && message.guildId && isBotCommandChannel(message))
    {
        await redis.del(userKey)
        return await handleTD(user, command, message)
    }
    //check minimums
    if (command.length < minStrLen && !qSearch)
    {
        return message.reply('Minimum ' + minStrLen + ' chars, please')
    }

    if (command.startsWith('servers') && isManager(user))
    {

        return message.reply(getServerList(client).map(
            (item, index) => `${index + 1}. ${item[1]}`).join('\n'))
    }
    //list all synonyms
    if (command.startsWith('listsyn'))
        return message.reply(await listSynonyms(user, command))

    //handle synonyms
    if (command.startsWith('^'))
        return message.reply(await handleSynonym(user, message))

    //check for synonyms
    let syn = await getSynonym(command)
    if (syn)
    {
        //check if there is an image link
        if (syn.value.startsWith('https:')) return message.reply({files: [syn.value]})
        //check if it should reply with a text message
        if (syn.value.startsWith('text:')) return message.reply(syn.value.replace('text:', ''))
        //else use the value as command
        command = syn.value
    } else if (command in dictionary.synonyms) command = dictionary.synonyms[command]

    //set limit to 10 if it is a bot-commands channel
    let limit = globalLimit
    if (isBotCommandChannel(message)) limit = 10
    //get all alt art images
    if (command.startsWith('alt'))
    {
        let syns = await getAllSynonyms()
        let files = syns.filter(syn => syn.key.startsWith(command)).map(syn => syn.value)
        if (files.length) {
            return message.reply({
                content:'Alternate art cards found: ' + files.length,
                files: files.slice(0, limit)
            })
        }

        return message.reply(translate(language, 'noresult'))
    }
    //check if in cache
    const cacheKey = cacheKeyPrefix + language+ ':' + command
    let keyExists = await redis.exists(cacheKey)
    if (keyExists)
    {
        console.time('cache')
        console.log('serving from cache: ', language, command, limit)
        let answer = await redis.json.get(cacheKey, '$')
        console.timeEnd('cache')
        return message.reply({
            content: answer.content,
            files: answer.files.slice(0, limit)
        })
    }
    //first search on KARDS.com, on no result search in the local DB
    let variables = {
        language: APILanguages[language],
        q: command,
        showSpawnables: true,
        showReserved: true,
    }
    const cards = await getCards(variables)
    if (!cards)
    {
        return message.reply(translate(language, 'error'))
    }
    const counter = cards.counter
    if (!counter)
    {
        if (qSearch) return //don't reply if nothing is found
        const imageURL = await getRandomImage()
        if (!imageURL) return message.reply(translate(language, 'noresult'))
        if (await bot.getFileSize(imageURL) > maxFileSize)
            return message.reply(translate(language, 'noresult'))
        return message.reply({
            content: translate(language, 'noresult'),
            files: [imageURL]
        })
    }
    //don't reply if more than one card is found via quotations
    if (qSearch && counter !== 1) return
    //if any cards are found - attach them
    let content = translate(language, 'search') + ': ' + counter
    //do not show any cards if there are more than 20 cards
    if (counter > 20 && !isBotCommandChannel(message))
    {
        return message.reply(content + translate(language, 'noshow'))
    }
    //warn that there are more cards found
    if (counter > limit)
    {
        content += translate(language, 'limit') + limit
    }
    //attach found images
    const files = getFiles(cards, language, limit)
    //reply to user
    try
    {
        message.reply({content: content, files: files})
        console.log(counter + ' card(s) found', files)
        //store in the cache
        await redis.json.set(cacheKey, '$', {
            content: content,
            files: files
        })

    } catch (e)
    {
        console.error(e.message)
        message.reply(translate(language, 'error'))
    }

}

module.exports = {discordHandler}