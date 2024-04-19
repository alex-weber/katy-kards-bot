const bot = require("./bot")
const {getUser, updateUser, getTopDeckStats, getSynonym} = require("../database/db")
const {defaultLanguage, getLanguageByInput, APILanguages} = require("../tools/language")
const {translate} = require("../tools/translator")
const {myTDRank} = require("../games/topDeck")
const {handleTD} = require("../games/topDeckController")
const {getStats, getServerList} = require("../tools/stats")
const {isManager, isBotCommandChannel,
    listSynonyms, handleSynonym, getCards, getFiles} = require("../tools/search")
const dictionary = require("../tools/dictionary")
const {getRandomImage} = require("../tools/nekosAPI")
const globalLimit = parseInt(process.env.LIMIT) || 5 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 4000 // buffer overflow protection :)
const maxFileSize = 5*1024*1024 //5MB
const jsoning = require("jsoning")
const cache = new jsoning(__dirname + "/../tmp/cache.json")
/**
 *
 * @param message
 * @param client
 * @returns {Promise<*>}
 */
async function discordHandler(message, client) {

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
    if (message.guildId && ! await bot.hasWritePermissions(client, message, cache)) return

    //it's a bot command
    //create a DM channel
    message.author.createDM()
    let guildName = ''
    let channelName = ''
    if (message.guildId) {
        guildName = message.guild.name
        channelName = message.channel.name
    }
    console.log('bot command:', guildName, channelName, message.author.username, '->', message.content)

    //remove all the prefixes from the beginning
    let command = bot.parseCommand(prefix, message.content)
    if (!command.length) return
    //set username
    const user = await getUser(message.author.id.toString())
    //check the status
    if (user.status !== 'active')
    {
        console.log('blocked user\n', user)

        return
    }
    if (!user.name) user.name = message.author.username
    //check the user language
    let language = defaultLanguage
    if (getLanguageByInput(command) === 'ru')
    {
        user.language = 'ru'
        await updateUser(user)
    }
    if (user.language !== defaultLanguage) language = user.language

    //show online stats
    if (command === 'ingame' || command === 'online')
    {
        getStats(language).
        then(res => { message.reply(res) }).
        catch(error => { console.error(error) })
        return
    }

    //switch language
    if (bot.isLanguageSwitch(command) && !qSearch)
    {
        language = await bot.switchLanguage(user, command)
        return message.reply(translate(language, 'langChange') + language.toUpperCase())
    }
    //handle command
    if (command === 'help') return message.reply(translate(language, 'help'))

    //clear cache
    if (command === 'cclear' && isManager(user))
    {
        await cache.clear()
        console.log('clear cache command from user ', user.name)
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

    if (command.startsWith('servers') && isManager(user)) {

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
    } else if (command in dictionary.synonyms)
    {
        command = dictionary.synonyms[command]
        //console.log('synonym found for ' + command)
    }

    //set limit to 10 if it is a bot-commands channel
    let limit = globalLimit
    if (isBotCommandChannel(message)) limit = 10
    //check if in cache
    const cacheKey = language+command
    if (cache.has(cacheKey)) {
        console.log('serving from cache: ', language, command, limit)
        let answer = await cache.get(cacheKey)
        return message.reply({content: answer.content, files: answer.files.slice(0, limit)})
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
    try {
        message.reply({content: content, files: files})
        console.log(counter + ' card(s) found', files)
        //store in the cache
        await cache.set(cacheKey, {content: content, files: files})
    } catch (e) {
        console.log(e.message)
        message.reply(translate(language, 'error'))
    }

}

module.exports = {discordHandler}