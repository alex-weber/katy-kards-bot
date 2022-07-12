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
const { getLanguageByInput, languages }= require('./language.js')
const dictionary = require('./dictionary')
//database
const JSONING = require('jsoning')
const db = new JSONING("database.json")
const BotID = '691253934710456360';

//start server
app.get('/', (req, res) => res.send('Bot is online.'))
app.listen(port, () => console.log(`Bot is listening at :${port}`))

// ================= DISCORD JS ===================
const {Client, Intents, Permissions} = require('discord.js')
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
    console.log(`Logged in as ${client.user.tag}!`, 'Server count: ' + client.guilds.cache.size)
    client.user.setActivity('KARDS search and stats')
})
//main block
try
{   //await new messages
    client.on('messageCreate', async message =>
    {
        //check for write permissions

        const clientMember = await message.guild.members.fetch(BotID)
        console.log(await clientMember.permissionsIn(message.guild.channel))
       /* let send = clientMember.permissions.has(Permissions.FLAGS.SEND_MESSAGES)
        let attach = clientMember.permissions.has(Permissions.FLAGS.ATTACH_FILES)
        console.log(clientMember, 'guildId: ' + msg.guildId +
          ' channelId: ' + msg.channelId,
          msg.content + ' from '
          + msg.author.username,
          ' send: ' + send +
          ' attach: ' + attach)
        if (!attach)
        {
            console.log('no write permissions. Will do nothing.')

            return
        }*/

        //not a bot command
        if (!message.content.startsWith('!')) return

        console.log(
          'received a bot command: ' +
          'guildId: ' + message.guildId +
          ' channelId: ' + message.channelId + '  ' +
          message.content + ' from ' + message.author.username)
        //remove the "!" sign and whitespaces from the beginning
        let command = message.content.slice(1).trim().toLowerCase()
        let language = await db.get(message.author.id)
        if (!language)
        {
            //try to find the language and store it in the DB
            language = getLanguageByInput(command)
            await db.set(message.author.id, language)
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
        if (message.content === '!!')
        {
            stats.getStats().then(res => { message.reply(res) }).catch(error => { console.log(error) })

            return
        }
        //switch language
        if (message.content.length === 3 && languages.includes(command.slice(0,2)))
        {
            language = command.slice(0,2)
            //for traditional chinese
            if (language === 'tw') language = 'zh-Hant'
            await db.set(message.author.id, language)
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
            if (command in dictionary.synonyms)
            {
                command = dictionary.synonyms[command]
                console.log('synonym found for ' + command)
            }
            let variables = {
                "language": language,
                "q": command,
                "showSpawnables": true,
            }
            search.getCards(variables)
                .then(res => {
                    if (!res) {
                        message.reply(translator.translate(language, 'error'))

                        return
                    }
                    const cards = res.data.data.cards.edges
                    const counter = res.data.data.cards.pageInfo.count
                    if (!counter) {
                        message.reply(translator.translate(language, 'noresult'))

                        return
                    }
                    //if any cards are found - attach them
                    let content = translator.translate(language, 'search') + ': ' + counter
                    //warn that there are more cards found
                    if (counter > limit) {
                        content += translator.translate(language, 'limit') + limit
                    }
                    //attach found images
                    const files = search.getFiles(cards, limit)
                    //reply to user
                    message.reply({content: content, files: files})
                }).catch(error => {
                    message.reply(translator.translate(language, 'error'))
                    console.error(error)
                })
        } //end of search
    }) // end of onMessageCreate
    //start bot session
    client.login(process.env.DISCORD_TOKEN).then( () => { console.log('client started') })
//end of global try
} catch (error) { console.log(error) }