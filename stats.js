const axios = require("axios");
const translator = require("./translator");

/**
 *
 * @returns {Promise<string>}
 */
async function formatStats() {

    const statsURL = 'https://steamcharts.com/app/544810/chart-data.json'
    let output = ''
    const response = await axios.get(statsURL)
    const body = response.data
    const offset = 3600*3000;//manually add to get the Moscow time
    for (let i = 1; i < 25; i++) {
        let date = new Date(body[body.length - i][0] + offset)
        let players = body[body.length - i][1];
        output +=
            date.getHours().toString().padStart(2, "0") + ':00 ' +
            '░'.repeat(Math.floor(players / 100)) + ' ' +
            players + '\n'
    }

    return output

}

/**
 *
 * @returns {Promise<string>}
 */
async function getPlayers() {

    const steamURL = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=544810'
    const response = await axios.get(steamURL)
    let output = translator.translate('en', 'online') + ': '
    const players = response.data.response.player_count
    output += players + '\n\n'

    return output
}

/**
 *
 * @returns {Promise<string>}
 */
async function getStats() {

    return  await getPlayers() + await formatStats()
}
//export
module.exports = { getStats }