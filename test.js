const search = require("./search")
const {getUser, getTopDeckStats} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs")
const { getHelp } = require('./translator.js')
const translator = require("./translator")
const dictionary = require("./dictionary")
const { topDeck, myTDRank } = require("./topDeck")


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
    let td = await topDeck('1', player, 'td tank')
    if (td.state === 'open') {

        if (td.unitType) {
            console.log('**' + td.unitType.toUpperCase()+ '** battle\n')
        }
    }
    console.log('Waiting for another player...')
    let player2 = await getUser('44')
    //console.log(player)
    td = await topDeck('1', player2, 'td')
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

//topDeckGame().catch((e) => {console.log(e) })
let unitType = ''
//unitType = 'artillery' + ' battle\n'
console.log( unitType.toUpperCase() + 'Waiting for another player...')





