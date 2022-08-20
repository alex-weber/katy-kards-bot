const search = require("./search")
const {getUser, updateUser, topDeck, getSynonym} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language");
const {handleSynonym} = require("./search");

async function searchBlya() {

    //try to find the language and store it in the DB
    let language = 'en'
    let variables = { language : language, showSpawnables: true }
    variables.q = 'infantry 4c'
    let cards = await search.getCards(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

async function topDeckGame() {

    let log = ''

    let player = await getUser('22')
    //console.log(player)
    log = await topDeck('1', player)
    console.log(log)
    let player2 = await getUser('44')
    //console.log(player)
    let td = await topDeck('1', player2)
    let lines = td.log.split('*')
    console.log(lines)
    //console.log(log)

}

async function syn()
{
    let player = await getUser('44')
    console.log(player)
    player.name = 'Bob'
    await updateUser(player)


}

topDeckGame().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })



