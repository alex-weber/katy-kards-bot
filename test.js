const search = require("./search")
const {getUser, updateUser} = require("./db")

async function searchBlya(language) {
    let variables = { language : language, showSpawnables: true }
    variables.q = 'ftp'
    let cards = await search.getCards(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

async function user(discordID) {
    const user = await getUser(discordID)
    console.log(user)
    user.language = 'de'
    const result = updateUser(user)
    console.log(user)

}

searchBlya('en').catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })

