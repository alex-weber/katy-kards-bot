//globals
const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
const defaultPrefix = process.env.DEFAULT_PREFIX || '!'
//modules
const {translate} = require('./translator.js')
const {getStats} = require('./stats')
const {getCards, getFiles, handleSynonym} = require('./search')
const limit = parseInt(process.env.LIMIT) || 10 //attachment limit for discord
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const {getLanguageByInput, languages, defaultLanguage} = require('./language.js')
const dictionary = require('./dictionary')
//database
const {getUser, updateUser, getSynonym, getTopDeckStats} = require("./db")
//random image service
const randomImageService = require('random-image-api')
const fs = require('fs')
//topDeck game
const {topDeck, myTDRank} = require('./topDeck')
//helpEmbed
const {helpEmbed} = require('./helpEmbed')
//telegram
const {telegramClient, telegramMessage, Input, getMediaGroup} = require('./telegram')
//bot
const bot = require('./bot')
//start http server
app.get('/', (req, res) => res.send('Discord-Bot is online.'))
//start listening for messages
app.listen(port, () => console.log(`Discord-Bot is listening at :${port}`))
// ================= DISCORD JS ===================
const {Client, Intents, Permissions} = require('discord.js')
const {drawBattlefield} = require('./canvasManager')
const {Telegraf} = require("telegraf");
const client = new Client(
    {
        intents: [
            Intents.FLAGS.GUILDS,
            Intents.FLAGS.GUILD_MESSAGES,
            Intents.FLAGS.GUILD_MEMBERS,
        ]
    })
//Discord-Bot login event
client.on('ready', () =>
{
    console.log(`Logged in as ${client.user.tag}`, 'Server count: ' + client.guilds.cache.size)
    const guildNames = client.guilds.cache.map(g => g.name).join("\n")
    console.log(guildNames)
    client.user.setActivity('WATCHING ' + client.guilds.cache.size + ' servers')
})
//main block
try
{   //await new messages
    client.on('messageCreate', async message =>
    {
        let prefix = bot.getPrefix(message)
        //is there a "bot command" maked with double quotation marks?
        let qSearch = bot.isQuotationSearch(message)
        if (qSearch)
        {
            //rewrite the message content with only needed information
            message.content = qSearch
            console.log('bot command with quotes inside a message:', message.content)
        }
        //not a bot command or bot
        else if (!message.content.startsWith(prefix) || message.author.bot ) return

        //check for write permissions
        if (!bot.hasWritePermissions(client, message)) return

        //it's a bot command
        console.log('bot command:', message.guild.name, message.author.username, '->', message.content)

        //set username
        const user = await getUser(message.author.id.toString())
        user.name = message.author.username
        //remove all the prefixes from the beginning
        let command = bot.parseCommand(prefix, message.content)

        //check the user language
        let language = defaultLanguage
        if (user.language !== defaultLanguage) language = user.language
        await updateUser(user)

        //handle command
        if (command === 'help') return await message.reply(translate(language, 'help'))

        //get top 9 TD ranking
        if (command === 'ranking' || command === 'rankings') return await message.reply(await getTopDeckStats())

        //user's TD ranking
        if (command === 'myrank') return await message.reply(myTDRank(user))

        //show online stats
        if (message.content === prefix + prefix || command === 'ingame' || command === 'online')
        {
            getStats(language).then(res =>
            {
                message.reply(res)
            }).catch(error =>
            {
                console.log(error)
            })

            return
        }

        //top deck game only in special channels
        if (
            command.startsWith('td') &&
            (message.channel.name.search('bot') !== -1 ||
                dictionary.botwar.channels.includes(message.channelId.toString())
            )
        )
        {
            console.log('starting top deck game')
            //let channel = client.channels.fetch(message.channelId)
            let td = await topDeck(message.channelId, user, command)
            if (td.state === 'open')
            {
                let unitType = ''
                if (td.unitType) unitType = td.unitType + ' battle\n'
                await message.reply(unitType.toUpperCase() + 'Waiting for another player...')

                return
            }
            if (td.state === 'finished')
            {
                //draw the image
                await message.reply('getting battle results...')
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
                    await message.reply('could not draw battle image\n' + td.log)
                    console.error(e.toString())
                }
            }

            return
        }

        //switch language
        if (message.content.length === 3 && languages.includes(command.slice(0, 2)))
        {
            language = command.slice(0, 2)
            //for traditional chinese
            if (language === 'tw') language = 'zh-Hant'
            user.language = language
            await updateUser(user)
            message.reply(
                translate(language, 'langChange') + language.toUpperCase()
            ).then(() =>
            {
                console.log('lang changed to', language.toUpperCase(), 'for', message.author.username)
            })

            return
        }
        if (command.length < minStrLen)
        {
            return await message.reply('Minimum ' + minStrLen + ' chars, please')
        }

        //handle synonyms
        if (command.startsWith('^'))
        {
            let done = await handleSynonym(user, command)
            if (done)
            {
                await message.reply(done)
            }

            return
        }

        //check for synonyms
        let syn = await getSynonym(command)
        if (syn)
        {
            //check if there is a image link
            if (syn.value.startsWith('https'))
            {
                await message.reply({files: [syn.value]})

                return
            } else command = syn.value
        } else if (command in dictionary.synonyms)
        {
            command = dictionary.synonyms[command]
            console.log('synonym found for ' + command)
        }

        //first search on KARDS.com, on no result search in the local DB
        let variables = {
            'language': language,
            'q': command,
            'showSpawnables': true,
        }
        const searchResult = await getCards(variables)
        if (!searchResult)
        {
            return await message.reply(translate(language, 'error'))
        }
        const counter = searchResult.counter
        if (!counter)
        {
            //don't reply if nothin is found
            if (qSearch) return
            try
            {
                //get a random cat/dog/hug image for no result
                let endpoints = ['meow', 'woof']
                //define the sample function to get a random array value
                Array.prototype.sample = function()
                {
                    return this[Math.floor(Math.random()*this.length)]
                }
                const image = await randomImageService.nekos(endpoints.sample())
                await message.reply(
                    {
                        content: translate(language, 'noresult'),
                        files: [image.toString()]
                    })
            } catch (e)
            {
                await message.reply(translate(language, 'noresult'))
                console.log(e)
            }

            return
        }
        //don't reply if more than one card is found via quotations
        if (qSearch && counter !== 1) return
        //if any cards are found - attach them
        let content = translate(language, 'search') + ': ' + counter
        //warn that there are more cards found
        if (counter > limit)
        {
            content += translate(language, 'limit') + limit
        }
        //attach found images
        const files = getFiles(searchResult, language)
        //reply to user
        await message.reply({content: content, files: files})
        console.log(counter + ' card(s) found', files)

    }) // end of onMessageCreate

    //start Discord-Bot's session
    client.login(process.env.DISCORD_TOKEN).then(() =>
    {
        console.log('Discord client started')
    })
    //start Telegram-Bot's session if TOKEN is set
    if (telegramClient) {

        telegramClient.on(telegramMessage('text'), async (ctx) => {
            let prefix = '!'
            let command = ctx.update.message.text
            if (!command.startsWith(prefix)) return
            //online players
            if (command === prefix+prefix) {
                getStats(language).then(res =>
                {
                    ctx.reply(res)
                })
            }
            //search
            command = bot.parseCommand(prefix, command)
            let language = getLanguageByInput(command)
            let variables = {
                'language': language,
                'q': command,
                'showSpawnables': true,
            }
            let searchResult = await getCards(variables)
            if (!searchResult) return
            if (!searchResult.counter) return await ctx.reply(translate(language, 'noresult'))
            let files = getFiles(searchResult, language)
            await ctx.reply(translate(language, 'search') + ': ' + searchResult.counter)
            if (searchResult.counter > 1)
            {
                try {
                    await ctx.replyWithMediaGroup(getMediaGroup(files))
                } catch (e) {
                    console.log(e)
                }
            }
            else if (searchResult.counter === 1) {
                await ctx.replyWithPhoto(files[0].attachment)
            }
        }) //end of telegram client.on(new message)
        telegramClient.launch().then(() =>
        {
            console.log('Telegram client started')
        })
    }
//end of global try
} catch (error)
{
    console.log(error)
}