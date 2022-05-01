
const search = require('./search.js')
const express = require('express')
const axios = require('axios')
const app = express()
const port = 3000
const translator = require('./translator.js')
const query = require('./query.js')
const limit = 10

app.get('/', (req, res) => res.send('Bot is online.'))
app.listen(port, () => console.log(`Bot is listening at http://localhost:${port}`))
// ================= START BOT CODE ===================
const { Client, Intents } = require('discord.js');
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES]
})

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`)
})

console.log(search.search('blitz 7k'))

try {

    client.on('messageCreate', msg => {

        if(msg.content == '!!') { //show stats

            let url = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=544810'

            axios.get(url)
                .then(function (response) {
                    // handle success
                    let language = 'ru'
                    let output = translator.translate(language, 'online') + ': '
                    const players = response.data.response.player_count
                    //console.log(players)
                    const offset = 3600*3000;//manually add to get the Moscow time
                    output += players + '\n\n'
                    //console.log(body.response.player_count, offset)
                    let url = 'https://steamcharts.com/app/544810/chart-data.json'
                    axios.get(url)
                        .then(function (response) {
                            output += translator.translate(language, 'stats') + ':'+ '\n\n'
                            let body = response.data
                            //console.log(response)
                            for (let i = 1; i < 25; i++) {
                                let date = new Date(body[body.length-i][0]+offset)

                                let players = body[body.length-i][1];
                                output = output +
                                    date.getHours().toString().padStart(2, "0") + ':00 ' +
                                    '░'.repeat(Math.floor(players/100)) + ' ' +
                                    players + '\n'
                            }
                            msg.reply(output)
                        }).catch(function (error) {
                        // handle error
                        console.log(error);
                    })


                })
                .catch(function (error) {
                    // handle error
                    console.log(error);
                })


        }
        //search on KARDS website
        else if (msg.content.startsWith('!') && msg.content.length > 2) {

            let language = 'ru'
            str = msg.content.substring(1).trim()
            const firstLetter = str.substring(0,1)
            const lastLetter = str.slice(-1);
            //console.log(str)
            //check if russian
            const cyrillicPattern = /^[\u0400-\u04FF]+$/
            if ( cyrillicPattern.test(firstLetter) || cyrillicPattern.test(lastLetter) ) language = 'ru'

            // Construct a schema, using GraphQL schema language
            const variables = {
                "language": language,
                "q": str,
                "showSpawnables": true
            }
            //search on kards.com
            axios.post('https://api.kards.com/graphql', {
                "operationName": "getCards",
                "variables": variables,
                "query": query
            })
                .then(res => {
                    const cards = res.data.data.cards.edges
                    const counter = res.data.data.cards.pageInfo.count
                    let content = translator.translate(language, 'search') + ': '
                    //console.log(counter)

                    if (counter > 0) {

                        if (counter > limit) content += counter + translator.translate(language, 'limit') + limit
                        let files = []
                        for (const [key, value] of Object.entries(cards)) {
                            files.push('https://www.kards.com' + value.node.imageUrl)
                            if (files.length == limit) break
                        }
                        //console.log(files)
                        //attach found cards
                        msg.reply({ content: content, files: files })

                    }
                    //reply that no cards are found
                    else msg.reply(translator.translate(language, 'noresult'))
                })
                .catch(error => {
                    msg.reply(translator.translate(language, 'error'))
                    console.error(error)
                })
        }

    })// end of onMessageCreate


    //start session
    client.login(process.env.DISCORD_TOKEN)

} catch(error) {
    console.error(error)
}