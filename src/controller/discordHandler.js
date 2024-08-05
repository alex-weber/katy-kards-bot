const bot = require("./bot")
const {
    getUser,
    updateUser,
    getTopDeckStats,
    getSynonym,
    getAllSynonyms,
    createMessage,
} = require("../database/db")
const {
    getLanguageByInput,
    APILanguages,
} = require("../tools/language")
const {translate} = require("../tools/translation/translator")
const {createDeckImages} = require("../tools/deck")
const {myTDRank} = require("../games/topDeck")
const {handleTD} = require("../games/topDeckController")
const {getStats, getServerList} = require("../tools/stats")
const {
    isManager, isBotCommandChannel,
    listSynonyms, handleSynonym,
    getCards, getFiles,
} = require("../tools/search")
const dictionary = require("../tools/dictionary")
const {getRandomImage} = require("../tools/nekosAPI")
const {getDeckCode} = require("./bot")
const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 4000 // buffer overflow protection :)
const cacheKeyPrefix = process.env.NODE_ENV === 'production' ? '' : 'dev:'
//wait for 5 sec. before processing the TD command
const slowModeInterval = parseInt(process.env.SLOW_MODE_INTERVAL) || 5000
//load more results button
const {getButtonRow} = require("../tools/button")
/**
 *
 * @param message
 * @param client
 * @param redis
 * @returns {Promise<*>}
 */
async function discordHandler(message, client, redis)
{
    //buttonInteraction for next results
    if (message.customId) {
        message.author = message.user
        message.author.bot = false
        let userCommandCacheKey = cacheKeyPrefix + 'user:' + message.user.id + ':command'
        message.content = await redis.get(userCommandCacheKey)
        if (!message.content) return message.reply('Invalid input!')
    }
    if (message.author.bot || message.content.length > maxStrLen) return
    //get a custom sever prefix if set
    const prefix = bot.getPrefix(message)
    //is there a "bot command" marked with double quotation marks?
    const qSearch = bot.isQuotationSearch(message)
    if (qSearch)
    {
        //rewrite the message content with only needed information
        console.log('bot command with quotes inside a message:', message.content)
        message.content = qSearch
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
    let guildName = ''
    let channelName = 'DM'
    if (message.guildId)
    {
        guildName = message.guild.name
        channelName = message.channel.name
    }
    console.log('bot command:', guildName, channelName,
        message.author.username, '->', message.content)

    //remove all the prefixes from the beginning
    let command = bot.parseCommand(prefix, message.content)
    //return if the message is empty
    if (!command.length) return

    //set a relative timer to the next day 00:00 UTC
    if (command === 'midnight')
    {
        const midnight = bot.getMidnight().toString()
        return message.reply('<t:'+midnight+':R>')
    }

    //set username
    let user
    const userId = message.author.id.toString()
    console.time('getUser_'+userId)
    const userKey = cacheKeyPrefix + 'user:' + userId
    const cachedUser = await redis.json.get(userKey, '$')
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
    console.timeEnd('getUser_'+userId)
    //check the status
    if (user.status !== 'active')
    {
        console.log('blocked user\n', user)
        if (user.mode) return message.reply(user.mode)

        return
    }
    if (!user.name)
    {
        user.name = message.author.username
        await updateUser(user)
    }
    //set user language to russian if they type in cyrillic
    let language = user.language
    if (getLanguageByInput(command) === 'ru' && language !== 'ru')
    {
        user.language = 'ru'
        console.time('updateUser'+userId)
        await updateUser(user)
        //change user language to ru
        await redis.json.set(userKey, '$.language', 'ru')
        console.timeEnd('updateUser'+userId)
        language = 'ru'
    }
    //save the command in the DB and in cache, no need to wait
    createMessage({authorId: user.id, content: command}).then()

    //show Deck as images
    if (bot.isDeckLink(command) || bot.isDeckCode(command))
    {
        //overwrite message.content with the deck code only
        //because command is lowercased, but we need the original
        command = getDeckCode(message.content)
        //check if in cache
        const deckKey = cacheKeyPrefix + 'deck:'+language+':' + command
        if (await redis.exists(deckKey))
        {
            const files = await redis.json.get(deckKey, '$')
            return message.reply({files: files})
        }

        //check if screenshot capturing is running, tell user to wait
        const screenshotKey = cacheKeyPrefix + 'screenshot'
        if (await redis.exists(screenshotKey))
        {
            return message.reply(translate(language, 'screenshotRunning'))
        }
        await redis.set(screenshotKey, 'running')
        createDeckImages(prefix, message, command, language, redis, deckKey).
        then(()=>
        {
            redis.del(screenshotKey)
            console.log('createDeckImages finished')
        })

        return
    }

    //show online stats
    if (command === 'ingame' || command === 'online')
    {
        const stats = await getStats(language)
        return message.reply(stats)
    }
    //create DM only if needed to avoid unneeded loop latency
    if (command === 'dm')
    {
        //create the DM channel
        console.log('creating DM...')
        await message.author.createDM()
        return message.reply(translate(language, 'dm'))
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
        message.reply('starting DB sync with kards.com...')
        const startTime = Date.now()
        console.time('db_sync')
        child.on('close', function(code)
        {
            console.timeEnd('db_sync')
            const endTime = Date.now()
            const duration = ((endTime - startTime)/1000).toFixed(3)
            if (code === 0)
                return message.reply('DB sync done in ' + duration + 's')
        })
        child.on('message', m => message.reply(m))
        child.on('error', function(error)
        {
            console.log(error)
            console.timeEnd('db_sync')
            return message.reply('DB sync error. Check log for details.')
        })

        return
    }

    //get top 9 TD ranking
    if (command.startsWith('ranking'))
        return message.reply(await getTopDeckStats())

    //user's TD ranking
    if (command === 'myrank')
        return message.reply(myTDRank(user))

    //top deck game only in special channels
    if (command.startsWith('td') && message.guildId && isBotCommandChannel(message))
    {
        // TD command spam protection.
        // Next command is allowed only after the time of slowModeInterval is passed
        const userTDKey = cacheKeyPrefix + 'td:' + user.id
        const unblockTime = await redis.get(userTDKey)
        if (Date.now() < unblockTime) return //not allowed, just do nothing

        await redis.del(userKey)
        redis.set(userTDKey, Date.now() + slowModeInterval)
        return await handleTD(user, command, message)
    }
    //check minimums
    if (command.length < minStrLen && !qSearch)
        return message.reply(translate(language, 'min'))


    if (command.startsWith('servers') && isManager(user))
        return message.reply(getServerList(client).map(
            (item, index) => `${index + 1}. ${item[1]}`).join('\n'))

    //list all synonyms
    if (command.startsWith('commands'))
        return message.reply(await listSynonyms(command))

    //handle synonyms
    if (command.startsWith('^'))
        return message.reply(await handleSynonym(user, message))

    //check for synonyms
    const syn = await getSynonym(command)
    if (syn)
    {
        //check if there is an image link
        if (syn.value.startsWith('http')) return message.reply({files: [syn.value]})
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
        const syns = await getAllSynonyms()
        const files = syns.filter(syn => syn.key.startsWith(command)).map(syn => syn.value)
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
    const keyExists = await redis.exists(cacheKey)
    if (keyExists && !message.customId)
    {
        console.time('cache')
        console.log('serving from cache: ', language, command, limit)
        const answer = await redis.json.get(cacheKey, '$')
        console.timeEnd('cache')
        return message.reply({
            content: answer.content,
            files: answer.files.slice(0, limit)
        })
    }
    //first search on KARDS.com, on no result search in the local DB
    const UserOffsetKey = userKey + ':offset'
    let offset = 0
    const variables = {
        language: APILanguages[language],
        q: command,
        showSpawnables: true,
        showReserved: true,
        first: limit,
        offset: offset,
    }
    //check if we need next page instead
    if (message.customId) {
        let result = await redis.get(UserOffsetKey)
        result = parseInt(result)
        if (!isNaN(result) && result > 0)
            offset = result
        else
            offset = limit
        variables.offset = offset
        //add limit to offset for the next fetch
        await redis.set(UserOffsetKey, (offset+limit).toString())
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
        if (!imageURL)
            return message.reply(translate(language, 'noresult'))

        return message.reply({
            content: translate(language, 'noresult'),
            files: [imageURL]
        })
    }

    //if any cards are found - attach them
    let content = translate(language, 'search') + ': ' + counter
    //do not show any cards if there are more than 20 cards
    if (counter > 20 && !isBotCommandChannel(message))
    {
        return message.reply(content + translate(language, 'noshow'))
    }
    let answer = {}
    //warn that there are more cards found
    if (counter > limit)
    {
        await redis.set(userKey + ':command', prefix+command)
        let toCounter = offset + limit
        if (toCounter > counter) toCounter = counter
        content += translate(language, 'limit') +
            (offset+1).toString() + ' - ' +
            toCounter.toString()
        //add the "Next" button (only in bot-command channels
        if (counter - offset > limit && isBotCommandChannel(message))
            answer.components = getButtonRow(translate(language, 'next'))
        else await redis.set(UserOffsetKey, '0')
    }
    //attach found images
    const files = getFiles(cards, language, limit)
    answer.content = content
    answer.files = files
    //reply to user
    try
    {
        if (message.customId)
        {
            // remove the button
            await message.message.edit({ components: [] })

            await message.reply({ content: translate(language, 'fetching') , ephemeral: true })

            return await message.followUp(answer)
        }
        message.reply(answer)
        console.log(counter + ' card(s) found', files)
        //set offset to 0
        await redis.set(UserOffsetKey, '0')
        //store in cache
        if (counter <= limit)
            await redis.json.set(cacheKey, '$', answer)

    } catch (e)
    {
        console.error(e.message)
        message.reply(translate(language, 'error'))
    }

}

module.exports = {discordHandler}