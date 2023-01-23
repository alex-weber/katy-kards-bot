const search = require("./search")
const {getUser, getTopDeckStats, updateUser} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym, isManager} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs")
const { getHelp } = require('./translator.js')
const translator = require("./translator")
const dictionary = require("./dictionary")
const { topDeck, myTDRank } = require("./topDeck")
const {getCardsStats, getStats} = require("./stats")


async function searchBlya() {

    //try to find the language and store it in the DB
    let language = 'ru'
    let variables = { language : language, showSpawnables: true }
    variables.q = 'leo'
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
    const battleImage = await drawBattlefield(td)
    console.log(td.log)

}

async function raiting()
{
    //await topDeckGame()
    //console.log(await getTopDeckStats())
    let user = await getUser('44')
    user.role = ''
    await updateUser(user)
    console.log(isManager(user))
}

async function cardsStats()
{
    //await topDeckGame()
    //console.log(await getTopDeckStats())
    let stats = await getStats('en')
    console.log(stats)

}
//searchBlya().catch((e) => {console.log(e) })

const prefix = '!'
let input = '!!!!!!!!!!!!!!!!! URA!'
let command = input
while (command.startsWith(prefix)) command = command.replace(prefix, '')
console.log(command.trim().toLowerCase())





