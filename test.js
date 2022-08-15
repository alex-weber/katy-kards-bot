
const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym,
    createCard,
    getCard,
} = require('./db')
const search = require("./search");
const { searchLanguages }= require('./language.js')
const {languages} = require("./language");

async function main() {

    let language = 'en'

    //for (const [, language] of Object.entries(searchLanguages)) {

        for (let i = 0; i < 1; i = i+20)
        {
            let variables = {
                "language": language,
                "q": 'hell',
                "showSpawnables": true,
                "offset": i,
            }
            let response = await search.getCards(variables)
            let cards = response.data.data.cards.edges
            for (const [, item] of Object.entries(cards))
            {
                let card = item.node
                card.language = language
                const dbCard = await getCard(card)
                if (!dbCard) {
                    let result = await createCard(card)
                    console.log(result)
                }
            }
        }


   // }

}


main().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })