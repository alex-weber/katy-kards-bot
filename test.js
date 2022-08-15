
const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym,
    createCard,
    cardExists,
} = require('./db')
const search = require("./search");
const { searchLanguages }= require('./language.js')
const {languages} = require("./language");

async function main() {

    let language = 'en'

    for (let i = 80; i < 840; i = i+20)
    {
        let variables = {
            "language": language,
            "q": '',
            "showSpawnables": true,
            "offset": i,
        }
        let response = await search.getCards(variables)
        let cards = response.data.data.cards.edges
        for (const [, item] of Object.entries(cards))
        {
            let card = item.node
            console.log(card)
            card.language = language
            const dbCard = await cardExists(card)
            if (!dbCard) {
                let result = await createCard(card)
                //console.log(result)
            }
        }
    }




}


main().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })