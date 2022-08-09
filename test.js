


const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym
} = require('./db')
const search = require("./search");
const { searchLanguages }= require('./language.js')

async function main() {


    let command = '554'
    for (const [, language] of Object.entries(searchLanguages)) {
        let variables = {
            "language": language,
            "q": command,
            "showSpawnables": true,
        }
        let cards = await search.getCards(variables)
        console.log(cards.data.data.cards.edges[0].node.imageUrl)
    }

}

main().catch((e) => {throw e})
    .finally(async () =>
    {
        console.log('Promise finalized')
    })