const bot = require("./bot")
const {
    getUser,
    updateUser,
    getTopDeckStats,
    getSynonym
} = require("../database/db")
const {
    getLanguageByInput,
    APILanguages
} = require("../tools/language")
const {translate} = require("../tools/translator")
const takeScreenshot = require("../tools/puppeteer")
const {myTDRank} = require("../games/topDeck")
const {handleTD} = require("../games/topDeckController")
const {getStats, getServerList} = require("../tools/stats")
const {
    isManager, isBotCommandChannel,
    listSynonyms, handleSynonym,
    getCards, getFiles,
} = require("../tools/search")
const dictionary = require("../tools/dictionary")
const {getDeckFiles, deleteDeckFiles} = require("../tools/fileManager")
const {getRandomImage} = require("../tools/nekosAPI")
const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 4000 // buffer overflow protection :)
const maxFileSize = 5 * 1024 * 1024 //5MB


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
    if (message.guildId && !await bot.hasWritePermissions(client, message, redis)) return
    console.timeEnd('permissions')

    //it's a bot command
    //create the DM channel
    message.author.createDM()
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
    let user = {}
    const userId = message.author.id.toString()
    let cachedUser = JSON.parse(await redis.get('user' + userId))
    if (!cachedUser || !cachedUser.hasOwnProperty('id'))
    {
        console.log('no user in cache, caching')
        user = await getUser(message.author.id.toString())
        await redis.set('user' + userId, JSON.stringify(user))
    }
    else
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
        //delete user from cache
        await redis.del('user' + userId)
        console.timeEnd('updateUser')
    }
    //show Deck as image
    if(bot.isDeckCommand(command))
    {
        message.reply('capturing a screenshot, this may take some seconds...')
        takeScreenshot(command)
            .then((result) =>
            {
                if (!result) return message.reply(translate(language, 'error'))
                const files = getDeckFiles()
                message.reply({ files: files })
                console.log('Screenshot captured and sent successfully')
                deleteDeckFiles()
            })
            .catch(error => console.error('Error capturing screenshot:', error))

        return
    }

    //show online stats
    if (command === 'ingame' || command === 'online')
    {
        getStats(language).then(res =>
        {
            message.reply(res)
        }).catch(error =>
        {
            console.error(error)
        })
        return
    }

    //switch language
    if (bot.isLanguageSwitch(command) && !qSearch)
    {
        language = await bot.switchLanguage(user, command)
        await redis.del('user' + userId)
        return message.reply(translate(language, 'langChange') + language.toUpperCase())
    }
    //handle command
    if (command === 'help') return message.reply(translate(language, 'help'))

    //clear cache
    if (command === 'cclear' && isManager(user))
    {
        redis.FLUSHDB('ASYNC', (err, succeeded) =>
        {
            console.log(succeeded); // will be true if success
        })
        //console.log('clear cache command from user ', user.name)
        return message.reply('cache cleared')
    }

    //get top 9 TD ranking
    if (command.startsWith('ranking')) return message.reply(await getTopDeckStats())

    //user's TD ranking
    if (command === 'myrank') return message.reply(myTDRank(user))

    //top deck game only in special channels
    if (command.startsWith('td') && message.guildId && isBotCommandChannel(message))
    {
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
        return message.reply(await handleSynonym(user, message.content))

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
    //check if in cache
    const cacheKey = language + command
    let keyExists = await redis.exists(cacheKey)
    if (keyExists)
    {
        console.time('cache')
        console.log('serving from cache: ', language, command, limit)
        let answer = JSON.parse(await redis.get(cacheKey))
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
        await redis.set(cacheKey, JSON.stringify({
            content: content,
            files: files
        }))
    } catch (e)
    {
        console.error(e.message)
        message.reply(translate(language, 'error'))
    }

}

module.exports = {discordHandler}