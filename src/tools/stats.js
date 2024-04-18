const axios = require("axios")
const {translate} = require("./translator")

/**
 *
 * @returns {Promise<string>}
 */
async function formatStats()
{
    const statsURL = 'https://steamcharts.com/app/544810/chart-data.json'
    let output = ''
    const response = await axios.get(statsURL)
    const body = response.data
    const divider = 100
    for (let i = 1; i < 25; i++)
    {
        let date = new Date(body[body.length - i][0])
        let players = body[body.length - i][1];
        output +=
            date.getHours().toString().padStart(2, "0") + ':00 ' +
            '░'.repeat(Math.floor(players / divider)) + ' ' +
            players + '\n'
    }

    return output
}

/**
 *
 * @param language
 * @returns {Promise<string>}
 */
async function getPlayers(language)
{
    const steamURL = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=544810'
    const response = await axios.get(steamURL)
    const date = new Date()
    let output = translate(language, 'time') +': '+
        date.getHours().toString().padStart(2, "0") +':'+
        date.getMinutes().toString().padStart(2, "0") +' GMT\n'
    output += translate(language, 'online') + ': '
    const players = response.data.response.player_count
    output += players + '\n\n'

    return output
}

/**
 *
 * @param language
 * @returns {Promise<string>}
 */
async function getStats(language)
{
    return await getPlayers(language) + await formatStats()
}

/**
 *
 * @param client
 * @returns {array}
 */
function getServerList(client) {
    return client.guilds.cache.map((g) => {
        let icon = 'https://cdn.discordapp.com/icons/'+
            g.id+'/'+ g.icon+'.webp?size=48'
        return [icon, g.name, g.id]
    })
}

module.exports = { getStats, getServerList}