const axios = require("axios")
const {translate} = require("./translator")
const {getCardsDB} = require("./db")
const dictionary = require("./dictionary")

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
    for (let i = 1; i < 25; i++)
    {
        let date = new Date(body[body.length - i][0])
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
 * @returns {Promise<*[]>}
 */
async function getCardsStats()
{

    /**
     *
     * @returns {{}}
     */
    function getFactionObject()
    {
        let factionObject = {}
        let rarities = {}
        for (let j = 0; j < dictionary.rarity.length; j++)
        {
            rarities[dictionary.rarity[j]] = 0
        }
        for (let i = 0; i < dictionary.type.length; i++)
        {

            let clone = rarities
            factionObject[dictionary.type[i]] = 0
        }

        return factionObject
    }

    const cards = await getCardsDB({})
    const len = cards.length
    let allCards = {}

    for (let i = 0; i < dictionary.faction.length; i++)
    {
        let faction = dictionary.faction[i]
        allCards[faction] = getFactionObject()
    }
    //console.log(allCards)

    for (let card = 0; card < len; card++)
    {
        let faction = cards[card].faction
        let type = cards[card].type
        let rarity = cards[card].rarity

        allCards[faction][type]++
        //console.log(faction, type, rarity, allCards.germany)
    }

    return allCards
}

module.exports = {getStats, getCardsStats}