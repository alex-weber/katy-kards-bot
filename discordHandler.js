const bot = require("./bot")
const {getUser, updateUser, getTopDeckStats, getSynonym} = require("./db")
const {defaultLanguage, getLanguageByInput} = require("./language")
const {translate} = require("./translator")
const {myTDRank, topDeck} = require("./topDeck")
const {getStats} = require("./stats")
const {isBotCommandChannel, listSynonyms, handleSynonym, getCards, getFiles} = require("./search")
const dictionary = require("./dictionary")
const {drawBattlefield} = require("./canvasManager")
const fs = require("fs")
const axios = require("axios")
const globalLimit = parseInt(process.env.LIMIT) || 10 //attachment limit
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const maxStrLen = 256 // buffer overflow protection :)
/**
 *
 * @param message
 * @param client
 * @returns {Promise<*>}
 */
async function discordHandler(message, client) {
    if (message.author.bot || message.content.length > maxStrLen) return
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
    if (! await bot.hasWritePermissions(client, message)) return

    //it's a bot command
    console.log('bot command:',
        message.guild.name,
        message.channel.name,
        message.author.username,
        '->',
        message.content)
    //remove all the prefixes from the beginning
    let command = bot.parseCommand(prefix, message.content)

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

    //switch language
    if (bot.isLanguageSwitch(command) && !qSearch)
    {
        language = await bot.switchLanguage(user, command)
        message.reply(
            translate(language, 'langChange') + language.toUpperCase()
        ).then(() =>
        {
            console.log('lang changed to', language.toUpperCase(), 'for', message.author.username)
        })

        return
    }
    //handle command
    if (command === 'help') return message.reply(translate(language, 'help'))

    //get top 9 TD ranking
    if (command === 'ranking' || command === 'rankings') return message.reply(await getTopDeckStats())

    //user's TD ranking
    if (command === 'myrank') return message.reply(myTDRank(user))

    //show online stats
    if (message.content === prefix + prefix || command === 'ingame' || command === 'online')
    {
        getStats(language).
        then(res => { message.reply(res) }).
        catch(error => { console.log(error) })

        return
    }

    //top deck game only in special channels
    if (command.startsWith('td') &&
        (isBotCommandChannel(message) ||
            dictionary.
            botwar.
            channels.
            includes(message.channelId.toString())
        ))
    {
        console.log('starting top deck game')
        let td = await topDeck(message.channelId, user, command)
        if (td.state === 'open')
        {
            let unitType = ''
            if (td.unitType) unitType = td.unitType + ' battle\n'

            return message.reply(
                unitType.toUpperCase() +
                'Waiting for another player...')
        }
        if (td.state === 'finished')
        {
            //draw the image
            message.reply('getting battle results...')
            try {
                const battleImage = await drawBattlefield(td)
                await message.reply({content: td.log, files: [battleImage]})
                console.log(td.log)
                //delete the battle image
                fs.rm(battleImage, function ()
                {
                    console.log('image deleted')
                })
            } catch (e) {
                message.reply('could not draw battle image\n' + td.log)
                console.error(e.toString())
            }
        }

        return
    }
    if (!command.length) return
    if (command.length < minStrLen && !qSearch)
    {
        return message.reply('Minimum ' + minStrLen + ' chars, please')
    }

    //list all synonyms
    if (command.startsWith('listsyn'))
    {
        let listing = await listSynonyms(user, command)
        if (listing) return message.reply(listing)

        return
    }
    //handle synonyms
    if (command.startsWith('^'))
    {
        let done = await handleSynonym(user, message.content)
        if (done)
        {
            message.reply(done)
        }

        return
    }

    //check for synonyms
    let syn = await getSynonym(command)
    if (syn)
    {
        //check if there is an image link
        if (syn.value.startsWith('https')) return message.reply({files: [syn.value]})
        else command = syn.value
    } else if (command in dictionary.synonyms)
    {
        command = dictionary.synonyms[command]
        console.log('synonym found for ' + command)
    }

    //first search on KARDS.com, on no result search in the local DB
    let variables = {
        language: language,
        q: command,
        showSpawnables: true,
        showReserved: true,
    }
    const searchResult = await getCards(variables)
    if (!searchResult)
    {
        return message.reply(translate(language, 'error'))
    }
    const counter = searchResult.counter
    if (!counter)
    {
        //don't reply if nothing is found
        if (qSearch) return
        try
        {
            //get a random cat|dog image for no result
            let endpoints = ['meow', 'woof']
            //define the sample function to get a random array value
            Array.prototype.sample = function()
            {
                return this[Math.floor(Math.random()*this.length)]
            }
            const endpoint = endpoints.sample()
            const image = await axios.get(`https://nekos.life/api/v2/img/${endpoint}`)
            message.reply(
                {
                    content: translate(language, 'noresult'),
                    files: [image.data.url.toString()]
                })
        } catch (e)
        {
            message.reply(translate(language, 'noresult'))
            console.log(e)
        }

        return
    }
    //don't reply if more than one card is found via quotations
    if (qSearch && counter !== 1) return
    //if any cards are found - attach them
    let content = translate(language, 'search') + ': ' + counter
    //set limit to 10 if it is a bot-commands channel
    let limit = globalLimit
    if (isBotCommandChannel(message)) limit = 10
    //warn that there are more cards found
    if (counter > limit)
    {
        content += translate(language, 'limit') + limit
    }
    //attach found images
    const files = getFiles(searchResult, language, limit)
    //reply to user
    try {
        message.reply({content: content, files: files})
        console.log(counter + ' card(s) found', files)
    } catch (e) {
        console.log(e.message)
        message.reply(translate(language, 'error'))
    }

}

module.exports = {discordHandler}