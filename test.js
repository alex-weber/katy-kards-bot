const search = require("./search")
const {getUser, updateUser} = require("./db")
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

async function user(command) {
    //check the user language
    let language = defaultLanguage
    const user = await getUser('22')
    if (user.language !== defaultLanguage)
    {
        language = user.language
        await updateUser(user)
    }
    console.log(language)

}

searchBlya().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })

