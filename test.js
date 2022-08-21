const search = require("./search")
const {getUser, updateUser, topDeck, getSynonym} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs");

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

    let player = await getUser('22')
    //console.log(player)
    await topDeck('1', player)
    let player2 = await getUser('44')
    //console.log(player)
    let td = await topDeck('1', player2)
    const battleImage = await drawBattlefield(td)
    console.log(td.log)
    //delete the battle image
    fs.rm(battleImage, function () {
        console.log('image deleted')
    })


}

async function syn()
{
    let player = await getUser('44')
    console.log(player)
    player.name = 'Bob'
    await updateUser(player)


}

topDeckGame().catch((e) => {console.log(e) })



