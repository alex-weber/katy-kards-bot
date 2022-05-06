//globals
const express = require('express')
const app = express()
const port = process.env.PORT
const translator = require('./translator.js')
const stats = require('./stats')
const search = require('./search')
const limit = process.env.LIMIT || 10
const getLanguage = require('./language.js')

app.get('/', (req, res) => res.send('Bot is online.'))
app.listen(port, () => console.log(`Bot is listening at :${port}`))
// ================= START BOT CODE ===================
const {Client, Intents} = require('discord.js');
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES]
})

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`)
})

//main block
try {

    client.on('messageCreate', msg => {

        //show stats
        if (msg.content === '!!') {
            stats.getStats().then(res => {
                msg.reply(res)
            }).catch(error => {
                console.error(error)
            })
        }
        //else search on KARDS website
        else if (msg.content.startsWith('!') && msg.content.length > 2) {
            //remove the "!" sign and whitespaces from the beginning
            let str = msg.content.substring(1).trim()
            let language = getLanguage(str)
            let variables = {
                "language": language,
                "q": str,
                "showSpawnables": true,
            }
            search.getCards(variables)
                .then(res => {
                    const cards = res.data.data.cards.edges
                    const counter = res.data.data.cards.pageInfo.count
                    let content = translator.translate(language, 'search') + ': '
                    if (counter > 0) {
                        content += counter
                        //warn that there are more cards found
                        if (counter > limit) {
                            content += translator.translate(language, 'limit') + limit
                        }
                        //attach found cards
                        const files = search.getFiles(cards, limit)
                        //reply to user
                        msg.reply({content: content, files: files})

                    }
                    //reply that no cards are found
                    else msg.reply(translator.translate(language, 'noresult'))
                })
                .catch(error => {
                    msg.reply(translator.translate(language, 'error'))
                    console.error(error)
                })
        } //end of search

    })// end of onMessageCreate

    //start bot session
    client.login(process.env.DISCORD_TOKEN)
//end of global try
} catch (error) {
    console.error(error)
}