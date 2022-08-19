const search = require("./search")
const {getUser, updateUser, topDeck} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language");

async function searchBlya() {

    //try to find the language and store it in the DB
    let language = getLanguageByInput('554')
    const user = await getUser('55')
    if (language !== defaultLanguage)
    {
        user.language = language
        await updateUser(user)
    }
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

    let log = ''

    let player = await getUser('22')
    //console.log(player)
    log = await topDeck('1', player)
    console.log(log)
    let player2 = await getUser('44')
    //console.log(player)
    log = await topDeck('1', player2)
    console.log(log)

}

topDeckGame().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })

