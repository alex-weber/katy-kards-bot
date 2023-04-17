const search = require("./search")
const {getUser, getTopDeckStats, updateUser, getCardsDB} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym, isManager, advancedSearch, getCards} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs")
const { getHelp } = require('./translator.js')
const translator = require("./translator")
const dictionary = require("./dictionary")
const { topDeck, myTDRank } = require("./topDeck")
const {getCardsStats, getStats} = require("./stats")


async function searchBlya(input) {

    //try to find the language and store it in the DB
    let language = 'en'
    let variables = { language : language, showSpawnables: true }
    variables.q = input
    let cards = await search.advancedSearch(variables)
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
    //const battleImage = await drawBattlefield(td)
    console.log(td)

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

async function quotes()
{
    let botCommand = /\".+\"/gm
    let message = 'you can use "air power to destroy any tank '
    if (botCommand.test(message))
    {
        let arr = message.split('"')
        if (arr[1] !== undefined ) console.log(arr[1])
    }

}

async function createJSON()
{
    let cards = await getCardsDB({})
    //console.log(cards)
    //save the file
    fs.writeFile(
        'export/cards.json',
        JSON.stringify(cards),
        function (err) {
            if (err) console.log('could not write file')
            else console.log('JSON created!')
        })
}
quotes().catch((e) => {console.log(e) })








