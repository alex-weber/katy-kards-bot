const search = require("./search")
const {getUser, updateUser, topDeck, getSynonym, getTopDeckStats, myTDRank} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs");
const { getHelp } = require('./translator.js')
async function searchBlya() {

    //try to find the language and store it in the DB
    let language = 'en'
    let variables = { language : language, showSpawnables: true }
    variables.q = 'infantry sov 1/1 0c light'
    let cards = await search.getCards(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

async function topDeckGame() {

    let player = await getUser('22')
    //console.log(player)
    await topDeck('1', player, 'td fighter')
    let player2 = await getUser('44')
    //console.log(player)
    let td = await topDeck('1', player2)
    //const battleImage = await drawBattlefield(td)
    console.log(td.log)



}

async function raiting()
{
    //await topDeckGame()
    console.log(await getTopDeckStats())
    let user = await getUser('1')
    console.log(myTDRank(user))

}

topDeckGame().catch((e) => {console.log(e) })




