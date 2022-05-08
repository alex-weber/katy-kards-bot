//globals
const express = require('express')
const app = express()
const port = process.env.PORT
const translator = require('./translator.js')
const stats = require('./stats')
const search = require('./search')
const limit = parseInt(process.env.LIMIT) || 10 //attachment limit for discord
const { getLanguageByInput, languages }= require('./language.js')
//database
const JSONING = require('jsoning');
const db = new JSONING("database.json");

//start server
app.get('/', (
    req,
    res) =>
    res.send('Bot is online.'))
app.listen(port, () =>
    console.log(`Bot is listening at :${port}`))

// ================= DISCORD JS ===================
const {Client, Intents} = require('discord.js');
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES]
})
//login event
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`)
})
//main block
try {
    client.on('messageCreate', async msg =>  {

        //remove the "!" sign and whitespaces from the beginning
        const str = msg.content.slice(1).trim().toLowerCase()
        //language
        let language = await db.get(msg.author.id)
        if (!language) {
            language = getLanguageByInput(str)
            await db.set(msg.author.id, language)
        }
        //show help
        if (msg.content === '!help') {
            msg.reply(translator.translate('en', 'help'))
        }
        //show stats
        else if (msg.content === '!!') {
            stats.getStats().then(res => {
                msg.reply(res)
            }).catch(error => {
                console.log(error)
            })
        }
        //switch language
        else if (languages.includes(str.slice(0,2))) {
            language = str.slice(0,2)
            await db.set(msg.author.id, language)
        }
        //else search on KARDS website
        else if (msg.content.startsWith('!') && msg.content.length > 2) {

            let variables = {
                "language": language,
                "q": str,
                "showSpawnables": true,
            }
            search.getCards(variables)
                .then(res => {
                    if (res) { //if the server responds with 200
                        const cards = res.data.data.cards.edges
                        const counter = res.data.data.cards.pageInfo.count
                        let content = translator.translate(language, 'search') + ': '
                        //if any cards are found - attach them
                        if (counter > 0) {
                            content += counter
                            //warn that there are more cards found
                            if (counter > limit) {
                                content += translator.translate(language, 'limit') + limit
                            }
                            //attach found images
                            const files = search.getFiles(cards, limit)
                            //reply to user
                            msg.reply({content: content, files: files})
                        }
                        else msg.reply(translator.translate(language, 'noresult'))
                    }
                    //reply that no cards are found
                    else msg.reply(translator.translate(language, 'noresult'))
                })
                .catch(error => {
                    msg.reply(translator.translate(language, 'error'))
                    console.error(error)
                })
        } //end of search
    }) // end of onMessageCreate

    //start bot session
    client.login(process.env.DISCORD_TOKEN).then(res => {
        console.log('started client')
    })

//end of global try
} catch (error) {
    console.log(error)
}