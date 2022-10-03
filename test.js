const search = require("./search")
const {getUser, getTopDeckStats, updateUser} = require("./db")
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
    variables.q = 'russian plane 5k'
    let cards = await search.getCards(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

async function topDeckGame() {

    let player = await getUser('124')

    return
    let td = await topDeck('1', player, 'td')
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
    //console.log(await getTopDeckStats())
    let user = await getUser('44')
    user.role = 'VIP'
    await updateUser(user)
    console.log(user)
    await handleSynonym(user, 'hui i pizda=igrali v poezda')

}
searchBlya().catch((e) => {console.log(e) })
//\\






