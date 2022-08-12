


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


    let command = ''
    //for (const [, language] of Object.entries(searchLanguages)) {
        let variables = {
            "language": 'en',
            "q": command,
            "showSpawnables": true,
        }
        let response = await search.getCards(variables)
        const counter = response.data.data.cards.pageInfo.count
        console.log('cards found: ' + counter)
        for (let i = 0; i < 2; i = i+20)
        {
            let variables = {
                "language": 'en',
                "q": '',
                "showSpawnables": true,
                "offset": i,
            }
            let response = await search.getCards(variables)
            let cards = response.data.data.cards.edges
            for (const [, item] of Object.entries(cards))
            {
                let card = item.node
                card.title = card.json.title['en-EN']

                console.log(card)
            }
        }


   // }

}

main().catch((e) => {throw e})
    .finally(async () =>
    {
        console.log('Promise finalized')
    })