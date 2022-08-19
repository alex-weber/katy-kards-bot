//globals
const express = require('express')
const app = express()
const port = parseInt(process.env.PORT) || 3000
//custom modules
const translator = require('./translator.js')
const stats = require('./stats')
const search = require('./search')
const limit = parseInt(process.env.LIMIT) || 10 //attachment limit for discord
const minStrLen = parseInt(process.env.MIN_STR_LEN) || 2
const { getLanguageByInput, languages, defaultLanguage }= require('./language.js')
const dictionary = require('./dictionary')
//database
const {getUser, updateUser, getSynonym} = require("./db")
//random image service
const randomImageService = require("random-image-api")


//start server
app.get('/', (req, res) => res.send('Bot is online.'))
app.listen(port, () => console.log(`Bot is listening at :${port}`))

// ================= DISCORD JS ===================
const {Client, Intents, Permissions} = require('discord.js')
const {handleSynonym} = require("./search");
const client = new Client(
  {
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MEMBERS,
    ]
  })
//login event
client.on('ready', () =>
{
    console.log(`Logged in as ${client.user.tag}!`,
      'Server count: ' + client.guilds.cache.size)
    client.user.setActivity('KARDS search on ' + client.guilds.cache.size + ' servers')
})
//main block
try
{   //await new messages
    client.on('messageCreate', async message =>
    {
        //do not react to bots
        if(message.author.bot) return
        //check for write permissions
        const clientMember = await message.guild.members.fetch(client.user.id)
        let permissions = message.channel.permissionsFor(clientMember)
        if (!permissions.has(Permissions.FLAGS.ATTACH_FILES) || !permissions.has(Permissions.FLAGS.SEND_MESSAGES))
        {
            console.log('no permissions.')

            return
        }
        //not a bot command
        if (!message.content.startsWith('!')) {
            //log the message
            let delimiter = ' -> '
            console.log(
              message.guild.name + delimiter +
              message.channel.name + delimiter +
              message.author.tag + delimiter +
              message.content)

            return
        }

        console.log(
          'received a bot command:',
          'guild:' + message.guild.name,
          'channel:' + message.channel.name,
          message.author.username, message.content)
        //remove the "!" sign and whitespaces from the beginning
        let command = message.content.slice(1).trim().toLowerCase()
        //check the user language
        let language = defaultLanguage
        const user = await getUser(message.author.id.toString())
        if (user.language !== defaultLanguage)
        {
            language = user.language
            await updateUser(user)
        }
        //golden signal
        if (command === 'golden signal' || command === 'gs')
        {
            await message.reply({content: 'here you are', files: ['https://i.imgur.com/IfBw6Eu.jpeg'] })

            return
        }
        //show help
        if (command === 'help')
        {
            await message.reply(translator.translate(language, 'help'))

            return
        }
        //show stats
        if (message.content === '!!' || message.content === '!ingame' || message.content === '!online')
        {
            stats.getStats().then(res => { message.reply(res) }).catch(error => { console.log(error) })

            return
        }
        //handle synonyms
        if (command.startsWith('+'))
        {
            let syn = await handleSynonym(user, command)
            console.log(user, command, syn)
            if (syn) {
                console.log('created synonym:', syn.key, ' -> ', syn.value)
            }

            return
        }
        //switch language
        if (message.content.length === 3 && languages.includes(command.slice(0,2)))
        {
            language = command.slice(0,2)
            //for traditional chinese
            if (language === 'tw') language = 'zh-Hant'
            user.language = language
            await updateUser(user)
            message.reply(
                translator.translate(language, 'langChange') + language.toUpperCase()
            ).then( () =>  {
                console.log('lang changed to ' +
                    language.toUpperCase() + ' for ' +
                    message.author.username)
            })

            return
        }
        if (command.length < minStrLen)
        {
            await message.reply('Minimum ' + minStrLen + ' chars, please')

        }
        //else search on KARDS website
        else
        {
            //check for synonyms
            let syn = await getSynonym(command)
            if (syn) command = syn.value
            else if (command in dictionary.synonyms)
            {
                command = dictionary.synonyms[command]
                console.log('synonym found for ' + command)
            }
            let variables = {
                "language": language,
                "q": command,
                "showSpawnables": true,
            }
            const searchResult = await search.getCards(variables)

            if (!searchResult) {
                await message.reply(translator.translate(language, 'error'))

                return
            }
            const counter = searchResult.counter
            if (!counter)
            {
                //get a random cat image for no result
                const catImage = await randomImageService.nekos("meow")
                await message.reply(
                  {content: translator.translate(language, 'noresult'),
                      files: [catImage.toString()]
                  })

                return
            }
            //if any cards are found - attach them
            let content = translator.translate(language, 'search') + ': ' + counter
            //warn that there are more cards found
            if (counter > limit) {
                content += translator.translate(language, 'limit') + limit
            }
            //attach found images
            const files = search.getFiles(searchResult, language)
            //reply to user
            await message.reply({content: content, files: files})
            console.log(counter + ' card(s) found', files)

        } //end of search
    }) // end of onMessageCreate
    //start bot session
    client.login(process.env.DISCORD_TOKEN).then( () => { console.log('client started') })
//end of global try
} catch (error) { console.log(error) }